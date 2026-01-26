import React, { useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { Modal } from '../components/Modal';
import { apiFetch } from '../api';

// --- Types & Interfaces ---
interface GuestProfile {
  id: string;
  name: string;
  role: 'VIP' | 'Staff' | 'Investor';
  monthlyLimit: number;
  currentUsage: number;
  status: 'Active' | 'Suspended';
  avatar: string;
}

interface AllowanceTransaction {
  id: string;
  guestId: string;
  guestName: string;
  date: string;
  amount: number;
  items: string;
}

// --- Mock Data ---
const INITIAL_GUESTS: GuestProfile[] = [];

const TRANSACTIONS: AllowanceTransaction[] = [];

export const Guests: React.FC = () => {
  // --- State ---
  const [activeTab, setActiveTab] = useState<'directory' | 'logs'>('directory');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [guests, setGuests] = useState<GuestProfile[]>(INITIAL_GUESTS);
  const [transactions, setTransactions] = useState<AllowanceTransaction[]>(TRANSACTIONS);
  const [sortMode, setSortMode] = useState<'none' | 'name_asc'>('none');
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [editLimitDraft, setEditLimitDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  
  // Filters
  const [filters, setFilters] = useState({
    vip: true,
    staff: true,
    investor: true,
    active: true,
    suspended: true,
  });

  // --- Derived State (Filtering) ---
  const filteredGuests = useMemo(() => {
    const base = guests.filter(guest => {
      const matchesSearch = guest.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            guest.id.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesRole = (guest.role === 'VIP' && filters.vip) ||
                          (guest.role === 'Staff' && filters.staff) ||
                          (guest.role === 'Investor' && filters.investor);
                          
      const matchesStatus = (guest.status === 'Active' && filters.active) ||
                            (guest.status === 'Suspended' && filters.suspended);

      return matchesSearch && matchesRole && matchesStatus;
    });

    if (sortMode === 'name_asc') {
      return [...base].sort((a, b) => a.name.localeCompare(b.name));
    }

    return base;
  }, [guests, searchQuery, filters, sortMode]);

  const toggleGuestStatus = (id: string) => {
    const current = guests.find((x) => x.id === id);
    const nextStatus = current?.status === 'Active' ? 'Suspended' : 'Active';

    setGuests((prev) => prev.map((g) => (g.id === id ? { ...g, status: nextStatus as any } : g)));
    queueMicrotask(async () => {
      try {
        await apiFetch(`/api/manager/guests/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        });
      } catch {
        // ignore
      }
    });
  };

  const selectedGuest = useMemo(() => guests.find((g) => g.id === selectedGuestId) ?? null, [guests, selectedGuestId]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 2400);
    return () => window.clearTimeout(t);
  }, [flash]);

  const stats = useMemo(() => {
    const totalCap = guests.reduce((sum, g) => sum + g.monthlyLimit, 0);
    const currentUsage = guests.reduce((sum, g) => sum + g.currentUsage, 0);
    const activeCount = guests.filter((g) => g.status === 'Active').length;
    return { totalCap, currentUsage, activeCount };
  }, [guests]);

  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter((t) =>
      t.id.toLowerCase().includes(q) || t.guestName.toLowerCase().includes(q) || t.items.toLowerCase().includes(q) || t.date.toLowerCase().includes(q),
    );
  }, [searchQuery, transactions]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        setLoading(true);
        const res = await apiFetch('/api/manager/guests');
        const json = (await res.json().catch(() => null)) as any;
        const rows = Array.isArray(json?.guests) ? (json.guests as any[]) : [];
        if (mounted) {
          setGuests(
            rows.map((g) => ({
              id: String(g.id),
              name: String(g.name || ''),
              role: (String(g.role || 'VIP') as any) || 'VIP',
              monthlyLimit: Number(g.monthlyLimit ?? g.monthly_limit ?? 0) || 0,
              currentUsage: Number(g.currentUsage ?? g.current_usage ?? 0) || 0,
              status: (String(g.status || 'Active') as any) || 'Active',
              avatar: String(g.avatar || g.avatarUrl || g.avatar_url || ''),
            })),
          );
        }
      } catch {
        // ignore
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (activeTab !== 'logs') return;
    let mounted = true;
    const run = async () => {
      try {
        const res = await apiFetch('/api/manager/guests/transactions?limit=200');
        const json = (await res.json().catch(() => null)) as any;
        const rows = Array.isArray(json?.transactions) ? (json.transactions as any[]) : [];
        if (!mounted) return;
        setTransactions(
          rows.map((t) => ({
            id: String(t.id),
            guestId: String(t.guestId ?? t.guest_id ?? ''),
            guestName: String(t.guestName ?? t.guest_name ?? ''),
            date: String(t.date || ''),
            amount: Number(t.amount ?? 0) || 0,
            items: String(t.items || ''),
          })),
        );
      } catch {
        // ignore
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [activeTab]);

  // --- Handlers ---
  const handleFilterChange = (key: keyof typeof filters) => {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleResetFilters = () => {
    setFilters({ vip: true, staff: true, investor: true, active: true, suspended: true });
    setSearchQuery('');
  };

  const handleAddGuest = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = String(formData.get('name') || '').trim();
    const role = String(formData.get('role') || '').trim();
    const monthlyLimit = Number(formData.get('limit')) || 0;
    if (!name || !role || !(monthlyLimit > 0)) return;

    (async () => {
      try {
        setLoading(true);
        const res = await apiFetch('/api/manager/guests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, role, monthlyLimit }),
        });
        const json = (await res.json().catch(() => null)) as any;
        const id = String(json?.id || '').trim();
        if (res.ok && id) {
          setGuests((prev) => [
            {
              id,
              name,
              role: role as any,
              monthlyLimit,
              currentUsage: 0,
              status: 'Active',
              avatar: '',
            },
            ...prev,
          ]);
          setShowAddModal(false);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground relative">
      <Header title="Guests & Allowances" subtitle="Manage VIP lists, staff allowances, and unpaid order limits" />

      {flash ? (
        <div className="px-4 md:px-8 pt-4">
          <div
            className={`max-w-[1280px] mx-auto rounded-xl border px-4 py-3 text-sm font-bold ${
              flash.kind === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                : 'bg-destructive/10 border-destructive/20 text-destructive'
            }`}
          >
            {flash.message}
          </div>
        </div>
      ) : null}

      <div className="border-b border-border bg-background px-4 md:px-8 py-4">
        <div className="max-w-[1280px] mx-auto">
          <div className="flex items-center gap-3">
            <div className="flex w-full items-stretch rounded-lg h-10 bg-card border border-border focus-within:border-primary/50 transition-colors">
              <div className="text-muted-foreground flex items-center justify-center pl-3">
                <span className="material-symbols-outlined text-[20px]">search</span>
              </div>
              <input
                className="w-full bg-transparent border-none text-foreground focus:ring-0 placeholder:text-muted-foreground/70 text-sm"
                placeholder={activeTab === 'logs' ? 'Search transactions...' : 'Search guests by name or ID...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Layout - Full Page Scroll */}
      <div className="flex-1 overflow-y-auto scroll-smooth">
        <div className="flex justify-center py-6 px-4 md:px-8">
            <div className="max-w-[1280px] w-full flex flex-col gap-6">
                
                {/* Page Heading & Actions */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-foreground text-3xl md:text-4xl font-black tracking-tight mb-2">Guests & Allowances</h1>
                        <p className="text-muted-foreground text-base">Manage VIP lists, staff allowances, and unpaid order limits.</p>
                    </div>
                    <button 
                        onClick={() => setShowAddModal(true)}
                        className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-5 py-2.5 rounded-lg font-bold text-sm transition-colors shadow-[0_0_15px_hsl(var(--primary)/0.15)]"
                    >
                        <span className="material-symbols-outlined text-[20px]">add_circle</span>
                        <span>Add New Profile</span>
                    </button>
                </div>

                {/* Stats Section */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-card rounded-xl p-6 border border-border flex flex-col justify-between">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2 bg-background rounded-lg text-primary">
                                <span className="material-symbols-outlined">payments</span>
                            </div>
                            <span className="text-emerald-700 dark:text-emerald-300 text-xs font-bold bg-emerald-500/10 px-2 py-1 rounded">+5% vs last mo</span>
                        </div>
                        <div>
                            <p className="text-muted-foreground text-sm font-medium mb-1">Total Authorized Cap</p>
                            <p className="text-foreground text-2xl font-bold tracking-tight">ETB {stats.totalCap.toLocaleString()}</p>
                        </div>
                    </div>
                    <div className="bg-card rounded-xl p-6 border border-border flex flex-col justify-between">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2 bg-background rounded-lg text-primary">
                                <span className="material-symbols-outlined">pie_chart</span>
                            </div>
                            <span className="text-emerald-700 dark:text-emerald-300 text-xs font-bold bg-emerald-500/10 px-2 py-1 rounded">+12% vs last mo</span>
                        </div>
                        <div>
                            <p className="text-muted-foreground text-sm font-medium mb-1">Current Usage</p>
                            <p className="text-foreground text-2xl font-bold tracking-tight">ETB {stats.currentUsage.toLocaleString()}</p>
                            <div className="w-full bg-muted rounded-full h-1.5 mt-3">
                                <div className="bg-primary h-1.5 rounded-full" style={{width: '30%'}}></div>
                            </div>
                        </div>
                    </div>
                    <div className="bg-card rounded-xl p-6 border border-border flex flex-col justify-between">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2 bg-background rounded-lg text-primary">
                                <span className="material-symbols-outlined">group</span>
                            </div>
                            <span className="text-emerald-700 dark:text-emerald-300 text-xs font-bold bg-emerald-500/10 px-2 py-1 rounded">{stats.activeCount} Active</span>
                        </div>
                        <div>
                            <p className="text-muted-foreground text-sm font-medium mb-1">Total Profiles</p>
                            <p className="text-foreground text-2xl font-bold tracking-tight">{guests.length}</p>
                        </div>
                    </div>
                </div>

                {/* Tabs Navigation */}
                <div className="border-b border-border mt-2 sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
                    <div className="flex gap-8">
                        <button 
                            onClick={() => setActiveTab('directory')}
                            className={`flex items-center gap-2 border-b-[3px] pb-3 pt-2 px-1 transition-colors ${activeTab === 'directory' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                        >
                            <span className="material-symbols-outlined text-[20px]">contacts</span>
                            <span className="text-sm font-bold">Guest Directory</span>
                        </button>
                        <button 
                            onClick={() => setActiveTab('logs')}
                            className={`flex items-center gap-2 border-b-[3px] pb-3 pt-2 px-1 transition-colors ${activeTab === 'logs' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                        >
                            <span className="material-symbols-outlined text-[20px]">receipt_long</span>
                            <span className="text-sm font-bold">Transaction Log</span>
                        </button>
                    </div>
                </div>

                {/* Main Content Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start pb-10">
                    
                    {/* Left Sidebar: Filters (Only for Directory) */}
                    {activeTab === 'directory' && (
                        <div className="hidden lg:flex flex-col gap-6 sticky top-20">
                            {/* Search Block */}
                            <div className="bg-card rounded-xl p-4 border border-border">
                                <h3 className="text-foreground font-bold text-sm mb-3 uppercase tracking-wider">Search</h3>
                                <label className="flex items-center gap-2 bg-background rounded-lg px-3 py-2.5 border border-transparent focus-within:border-primary transition-all">
                                    <span className="material-symbols-outlined text-muted-foreground text-[20px]">search</span>
                                    <input 
                                        className="bg-transparent border-none text-foreground text-sm placeholder:text-muted-foreground/50 focus:ring-0 w-full p-0" 
                                        placeholder="Name or ID..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                </label>
                            </div>
                            {/* Filter Block */}
                            <div className="bg-card rounded-xl p-5 border border-border">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-foreground font-bold text-sm uppercase tracking-wider">Filters</h3>
                                    <button onClick={handleResetFilters} className="text-xs text-primary hover:text-foreground transition-colors">Reset</button>
                                </div>
                                <div className="space-y-5">
                                    <div>
                                        <p className="text-muted-foreground text-xs font-bold mb-3">GUEST TYPE</p>
                                        <div className="space-y-2">
                                            <label className="flex items-center gap-3 cursor-pointer group">
                                                <input checked={filters.vip} onChange={() => handleFilterChange('vip')} className="rounded border-border bg-background text-primary focus:ring-offset-background focus:ring-primary/50" type="checkbox"/>
                                                <span className="text-foreground text-sm group-hover:text-primary transition-colors">VIP Members</span>
                                            </label>
                                            <label className="flex items-center gap-3 cursor-pointer group">
                                                <input checked={filters.staff} onChange={() => handleFilterChange('staff')} className="rounded border-border bg-background text-primary focus:ring-offset-background focus:ring-primary/50" type="checkbox"/>
                                                <span className="text-foreground text-sm group-hover:text-primary transition-colors">Staff</span>
                                            </label>
                                            <label className="flex items-center gap-3 cursor-pointer group">
                                                <input checked={filters.investor} onChange={() => handleFilterChange('investor')} className="rounded border-border bg-background text-primary focus:ring-offset-background focus:ring-primary/50" type="checkbox"/>
                                                <span className="text-foreground text-sm group-hover:text-primary transition-colors">Investors</span>
                                            </label>
                                        </div>
                                    </div>
                                    <div className="h-px bg-border"></div>
                                    <div>
                                        <p className="text-muted-foreground text-xs font-bold mb-3">STATUS</p>
                                        <div className="space-y-2">
                                            <label className="flex items-center gap-3 cursor-pointer group">
                                                <input checked={filters.active} onChange={() => handleFilterChange('active')} className="rounded border-border bg-background text-primary focus:ring-offset-background focus:ring-primary/50" type="checkbox"/>
                                                <span className="text-foreground text-sm group-hover:text-primary transition-colors">Active</span>
                                            </label>
                                            <label className="flex items-center gap-3 cursor-pointer group">
                                                <input checked={filters.suspended} onChange={() => handleFilterChange('suspended')} className="rounded border-border bg-background text-primary focus:ring-offset-background focus:ring-primary/50" type="checkbox"/>
                                                <span className="text-foreground text-sm group-hover:text-primary transition-colors">Suspended</span>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Right Side: Data Table */}
                    <div className={`${activeTab === 'directory' ? 'lg:col-span-3' : 'lg:col-span-4'} bg-card rounded-xl border border-border flex flex-col`}>

                        {/* DIRECTORY VIEW */}
                        {activeTab === 'directory' && (
                            <>
                                <div className="flex items-center justify-between p-4 border-b border-border bg-background/50 rounded-t-xl">
                                    <p className="text-foreground font-bold text-sm">Showing {filteredGuests.length} Profiles</p>
                                    <div className="flex gap-2">
                                        <button onClick={() => setSortMode((m) => (m === 'name_asc' ? 'none' : 'name_asc'))} className="flex items-center gap-1 text-muted-foreground hover:text-foreground px-3 py-1.5 rounded hover:bg-accent transition-colors text-sm">
                                            <span className="material-symbols-outlined text-[18px]">sort</span>
                                            <span>{sortMode === 'name_asc' ? 'Sorted A “Z' : 'Sort'}</span>
                                        </button>
                                        <button onClick={() => window.print()} className="flex items-center gap-1 text-muted-foreground hover:text-foreground px-3 py-1.5 rounded hover:bg-accent transition-colors text-sm">
                                            <span className="material-symbols-outlined text-[18px]">download</span>
                                            <span>Export</span>
                                        </button>
                                    </div>
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead className="bg-background text-muted-foreground text-xs uppercase tracking-wider font-semibold border-b border-border">
                                            <tr>
                                                <th className="p-4 w-[30%]">Guest / Role</th>
                                                <th className="p-4 w-[15%]">Monthly Limit</th>
                                                <th className="p-4 w-[25%]">Usage</th>
                                                <th className="p-4 w-[15%]">Balance</th>
                                                <th className="p-4 w-[10%]">Status</th>
                                                <th className="p-4 w-[5%]"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {filteredGuests.length === 0 ? (
                                                <tr>
                                                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                                                        {loading ? 'Loading ¦' : 'No guests found matching your filters.'}
                                                    </td>
                                                </tr>
                                            ) : filteredGuests.map(guest => {
                                                const percentUsed = (guest.currentUsage / guest.monthlyLimit) * 100;
                                                const balance = guest.monthlyLimit - guest.currentUsage;
                                                const isCritical = balance < 100;

                                                return (
                                                    <tr key={guest.id} className="group hover:bg-accent transition-colors">
                                                        <td className="p-4">
                                                            <div className="flex items-center gap-3">
                                                                <div className="size-10 rounded-full bg-cover bg-center border border-border" style={{backgroundImage: guest.avatar ? `url(\"${guest.avatar}\")` : undefined}}></div>
                                                                <div>
                                                                    <p className="text-foreground font-bold text-sm">{guest.name}</p>
                                                                    <div className="flex items-center gap-1 mt-0.5">
                                                                        <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${
                                                                            guest.role === 'VIP' ? 'bg-primary/15 text-primary ring-primary/20' :
                                                                            guest.role === 'Staff' ? 'bg-muted text-foreground ring-border' :
                                                                            'bg-purple-500/10 text-purple-700 dark:text-purple-300 ring-purple-500/20'
                                                                        }`}>{guest.role.toUpperCase()}</span>
                                                                        <span className="text-muted-foreground text-xs">ID: #{guest.id}</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="p-4">
                                                            <span className="text-foreground text-sm font-medium">ETB {guest.monthlyLimit.toLocaleString()}</span>
                                                        </td>
                                                        <td className="p-4">
                                                            <div className="w-full flex flex-col gap-1.5">
                                                                <div className="flex justify-between text-xs">
                                                                    <span className="text-foreground font-medium">ETB {guest.currentUsage.toLocaleString()}</span>
                                                                    <span className={percentUsed > 90 ? 'text-destructive' : 'text-muted-foreground'}>{percentUsed.toFixed(0)}%</span>
                                                                </div>
                                                                <div className="w-full bg-muted rounded-full h-1.5">
                                                                    <div className={`h-1.5 rounded-full ${percentUsed > 90 ? 'bg-destructive' : 'bg-primary'}`} style={{width: `${Math.min(percentUsed, 100)}%`}}></div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="p-4">
                                                            <span className={`text-sm font-bold ${isCritical ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-300'}`}>ETB {balance.toLocaleString()}</span>
                                                            {isCritical && <span className="material-symbols-outlined text-[14px] text-destructive ml-1 align-middle" title="Low Balance">warning</span>}
                                                        </td>
                                                        <td className="p-4">
                                                            <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${
                                                                guest.status === 'Active'
                                                                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20'
                                                                  : 'bg-destructive/10 text-destructive ring-destructive/20'
                                                            }`}>
                                                                {guest.status}
                                                            </span>
                                                        </td>
                                                        <td className="p-4 text-right">
                                                            <button
                                                                onClick={() => {
                                                                    setSelectedGuestId(guest.id);
                                                                    setEditLimitDraft(String(guest.monthlyLimit));
                                                                }}
                                                                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-accent"
                                                                title="Details"
                                                            >
                                                                <span className="material-symbols-outlined">more_vert</span>
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}

                        {/* LOGS VIEW */}
                        {activeTab === 'logs' && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-background text-muted-foreground text-xs uppercase tracking-wider font-semibold border-b border-border">
                                        <tr>
                                            <th className="p-4">Transaction ID</th>
                                            <th className="p-4">Guest</th>
                                            <th className="p-4">Date</th>
                                            <th className="p-4">Items</th>
                                            <th className="p-4 text-right">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {filteredTransactions.map(trx => (
                                            <tr key={trx.id} className="hover:bg-accent transition-colors">
                                                <td className="p-4 text-sm font-mono text-muted-foreground">{trx.id}</td>
                                                <td className="p-4 text-foreground font-bold text-sm">{trx.guestName}</td>
                                                <td className="p-4 text-muted-foreground text-sm">{trx.date}</td>
                                                <td className="p-4 text-foreground text-sm">{trx.items}</td>
                                                <td className="p-4 text-right text-foreground font-mono font-bold">ETB {trx.amount}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
      </div>

      {/* Add Guest Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
            <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl animate-fade-in">
                <div className="p-6 border-b border-border flex justify-between items-center bg-card rounded-t-2xl">
                    <h3 className="text-xl font-bold text-foreground">New Guest Profile</h3>
                    <button onClick={() => setShowAddModal(false)} className="text-muted-foreground hover:text-foreground">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
                <form onSubmit={handleAddGuest} className="p-6 flex flex-col gap-4">
                    <div>
                        <label className="block text-muted-foreground text-xs font-bold uppercase mb-2">Full Name</label>
                        <input name="name" required className="w-full bg-background border border-border rounded-lg px-4 py-3 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none" placeholder="e.g. Abebe Bikila" />
                    </div>
                    <div>
                        <label className="block text-muted-foreground text-xs font-bold uppercase mb-2">Role Type</label>
                        <select name="role" className="w-full bg-background border border-border rounded-lg px-4 py-3 text-foreground focus:border-primary outline-none">
                            <option value="VIP">VIP Guest</option>
                            <option value="Staff">Staff Member</option>
                            <option value="Investor">Investor / Owner</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-muted-foreground text-xs font-bold uppercase mb-2">Monthly Allowance Limit (ETB)</label>
                        <input name="limit" type="number" required defaultValue={2000} className="w-full bg-background border border-border rounded-lg px-4 py-3 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none" />
                    </div>
                    <div className="pt-4 flex gap-3">
                        <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 py-3 rounded-lg border border-border bg-secondary text-muted-foreground font-bold hover:text-foreground hover:bg-secondary/80 transition-colors">Cancel</button>
                        <button type="submit" className="flex-1 py-3 rounded-lg bg-primary text-primary-foreground font-bold hover:bg-primary/90 transition-colors">Create Profile</button>
                    </div>
                </form>
            </div>
        </div>
      )}

      <Modal
        open={selectedGuest != null}
        title={selectedGuest ? `${selectedGuest.name} (${selectedGuest.role})` : 'Guest Details'}
        onClose={() => {
          setSelectedGuestId(null);
          setEditLimitDraft('');
          setDeleteOpen(false);
        }}
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => {
                setSelectedGuestId(null);
                setEditLimitDraft('');
                setDeleteOpen(false);
              }}
              className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
            >
              Close
            </button>
            {selectedGuest ? (
              <button
                onClick={() => setDeleteOpen(true)}
                className="flex-1 h-11 rounded-lg bg-destructive/10 hover:bg-destructive/20 border border-destructive/20 text-destructive font-extrabold transition-colors"
              >
                Delete
              </button>
            ) : null}
            {selectedGuest ? (
              <button
                onClick={() => toggleGuestStatus(selectedGuest.id)}
                className="flex-1 h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-extrabold transition-colors"
              >
                {selectedGuest.status === 'Active' ? 'Suspend' : 'Activate'}
              </button>
            ) : null}
          </div>
        }
      >
        {selectedGuest ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="size-12 rounded-full bg-cover bg-center border border-border" style={{ backgroundImage: `url(\"${selectedGuest.avatar}\")` }}></div>
              <div className="flex flex-col">
                <div className="text-foreground font-bold">{selectedGuest.name}</div>
                <div className="text-muted-foreground text-xs">ID: #{selectedGuest.id}    Status: {selectedGuest.status}</div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card/50 p-4">
              <div className="text-xs text-muted-foreground font-bold uppercase">Monthly Allowance Limit (ETB)</div>
              <div className="mt-2 flex items-center gap-3">
                <input
                  value={editLimitDraft}
                  onChange={(e) => setEditLimitDraft(e.target.value)}
                  className="flex-1 h-11 bg-background border border-border rounded-lg px-3 text-foreground"
                />
                <button
                  onClick={() => {
                    const next = Number(editLimitDraft);
                    if (!Number.isFinite(next) || next <= 0) return;
                    setGuests((prev) => prev.map((g) => (g.id === selectedGuest.id ? { ...g, monthlyLimit: next } : g)));
                    queueMicrotask(async () => {
                      try {
                        await apiFetch(`/api/manager/guests/${encodeURIComponent(selectedGuest.id)}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ monthlyLimit: next }),
                        });
                      } catch {
                        // ignore
                      }
                    });
                  }}
                  className="h-11 px-5 rounded-lg bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-accent font-bold"
                >
                  Save
                </button>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">Current usage: ETB {selectedGuest.currentUsage.toLocaleString()}</div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={deleteOpen && selectedGuest != null}
        title={selectedGuest ? `Delete ${selectedGuest.name}?` : 'Delete Guest'}
        onClose={() => setDeleteOpen(false)}
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => setDeleteOpen(false)}
              className="flex-1 h-11 rounded-lg bg-secondary hover:bg-secondary/80 border border-border text-foreground font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!selectedGuest) return;
                const id = selectedGuest.id;
                setLoading(true);
                (async () => {
                  try {
                    const res = await apiFetch(`/api/manager/guests/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    const json = (await res.json().catch(() => null)) as any;
                    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
                    setGuests((prev) => prev.filter((g) => g.id !== id));
                    setSelectedGuestId(null);
                    setEditLimitDraft('');
                    setDeleteOpen(false);
                    setFlash({ kind: 'success', message: 'Guest deleted.' });
                  } catch (e) {
                    setFlash({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to delete guest.' });
                  } finally {
                    setLoading(false);
                  }
                })();
              }}
              className="flex-1 h-11 rounded-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground font-extrabold transition-colors disabled:opacity-60"
              disabled={loading}
            >
              {loading ? 'Deleting ¦' : 'Delete'}
            </button>
          </div>
        }
      >
        <div className="text-sm text-muted-foreground">
          This will permanently remove the guest profile from this branch.
        </div>
      </Modal>
    </div>
  );
};