import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Screen } from '../types';
import { apiFetch } from '../api';
import { clearSession, readSession, updateSession } from '../session';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Modal } from '../components/ui/modal';
import { Label } from '../components/ui/label';
import { Select } from '../components/ui/select';

export const BranchSelect: React.FC = () => {
  const session = useMemo(() => readSession<any>(), []);

  const displayName = useMemo(() => {
    const n = typeof session?.staffName === 'string' ? session.staffName.trim() : '';
    if (n) return n;
    const sid = typeof session?.staffId === 'string' ? session.staffId.trim() : '';
    return sid || 'User';
  }, [session]);

  const roleLabel = useMemo(() => {
    const r = typeof session?.role === 'string' ? session.role.trim() : '';
    return r || 'Staff';
  }, [session]);

  const initials = useMemo(() => {
    const parts = String(displayName || '').split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] || 'U';
    const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : '';
    return (a + b).toUpperCase();
  }, [displayName]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<'All' | 'Open' | 'Closed' | 'Maintenance'>('All');
  const [branches, setBranches] = useState<
    Array<{ id: string; name: string; managerName: string; city: string; address: string; phone: string; status: string; rating: number }>
  >([]);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    managerName: '',
    city: '',
    address: '',
    phone: '',
    status: 'Open' as 'Open' | 'Closed' | 'Maintenance',
    rating: '4.6',
  });

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/branches');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        branches: Array<{ id: string; name: string; managerName: string; city?: string; address?: string; phone?: string; status: string; rating: number }>;
      };
      setBranches(Array.isArray(data.branches) ? data.branches : []);
    } catch {
      setError('Backend not reachable. Start API server (npm run dev:api).');
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return branches.filter((b) => {
      const statusOk = chip === 'All' ? true : (b.status || '').toLowerCase() === chip.toLowerCase();
      const qOk = !q ? true : b.name.toLowerCase().includes(q) || b.id.toLowerCase().includes(q);
      return statusOk && qOk;
    });
  }, [branches, chip, query]);

  const normalizeBranchId = (v: string) => {
    const s = String(v || '').trim();
    if (!s) return '';
    if (s === 'global') return '';
    if (s.startsWith('b_') && !s.startsWith('br_')) return `br_${s.slice(2)}`;
    return s;
  };

  const resolveReturnScreen = (): Screen => {
    try {
      const raw = localStorage.getItem('mirachpos.branchSelect.returnScreen.v1') || '';
      const v = raw.trim();
      return (Object.values(Screen) as string[]).includes(v) ? (v as Screen) : Screen.OWNER_DASHBOARD;
    } catch {
      return Screen.OWNER_DASHBOARD;
    }
  };

  const selectBranch = (id: string) => {
    try {
      const norm = normalizeBranchId(id);
      localStorage.setItem('mirachpos.owner.selectedBranchId.v1', norm);
      const next = resolveReturnScreen();
      localStorage.setItem('mirachpos.lastScreen.v1', String(next));
      localStorage.removeItem('mirachpos.branchSelect.returnScreen.v1');
      updateSession({ screen: next, branchId: norm });

      try {
        window.dispatchEvent(new Event('mirachpos-session-changed'));
      } catch {
        // ignore
      }

      try {
        window.location.hash = `#${String(next)}`;
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  };

  const logout = () => {
    try {
      localStorage.removeItem('mirachpos.owner.selectedBranchId.v1');
    } catch {
      // ignore
    }
    clearSession();
    window.location.reload();
  };

  const openCreate = () => {
    setCreateForm({
      name: '',
      managerName: '',
      city: '',
      address: '',
      phone: '',
      status: 'Open',
      rating: '4.6',
    });
    setError(null);
    setCreateOpen(true);
  };

  const createBranch = async () => {
    const name = createForm.name.trim();
    if (!name) {
      setError('Branch name is required.');
      return;
    }
    const ratingNum = Number(createForm.rating);
    const rating = Number.isFinite(ratingNum) ? Math.min(5, Math.max(0, ratingNum)) : 4.6;

    setCreating(true);
    setError(null);
    try {
      const res = await apiFetch('/api/branches/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          managerName: createForm.managerName.trim(),
          city: createForm.city.trim(),
          address: createForm.address.trim(),
          phone: createForm.phone.trim(),
          status: createForm.status,
          rating,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchBranches();
      setCreateOpen(false);
    } catch {
      setError('Failed to create branch. Make sure the API server is running.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground antialiased flex flex-col font-sans">
      {/* Top Navigation */}
      <header className="sticky top-0 z-50 flex items-center justify-between border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-6 py-3 lg:px-10">
        <div className="flex items-center gap-4">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary text-primary-foreground">
            <span className="material-symbols-outlined">point_of_sale</span>
          </div>
          <h2 className="text-xl font-bold leading-tight tracking-tight">MirachPos</h2>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden flex-col items-end md:flex">
            <span className="text-sm font-bold leading-none">{displayName}</span>
            <span className="text-xs text-muted-foreground">{roleLabel}</span>
          </div>
          <div className="h-10 w-10 overflow-hidden rounded-full ring-2 ring-border bg-secondary flex items-center justify-center text-sm font-black">
            {initials}
          </div>
          <Button variant="ghost" size="icon" onClick={logout} className="h-10 w-10 rounded-full hover:bg-destructive/10 hover:text-destructive">
            <span className="material-symbols-outlined">logout</span>
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex justify-center p-6 md:p-10 lg:p-20">
          <div className="w-full max-w-5xl flex flex-col gap-8">
            {/* Heading & Controls */}
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap justify-between items-end gap-4">
                <div className="flex flex-col gap-1">
                  <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Select Store Location</h1>
                  <p className="text-muted-foreground text-base">Choose a branch to manage orders and inventory.</p>
                </div>
                <Button onClick={openCreate} className="gap-2 shadow-lg">
                  <span className="material-symbols-outlined text-lg">add_business</span>
                  New Branch
                </Button>
              </div>

              {/* Search & Filter Bar */}
              <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center bg-card p-2 rounded-xl border shadow-sm">
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground material-symbols-outlined">search</span>
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-10 border-0 bg-secondary/50 focus-visible:ring-1 focus-visible:ring-primary focus-visible:bg-background transition-all"
                    placeholder="Find a branch by name or city..."
                  />
                </div>
                <div className="hidden md:block w-px h-8 bg-border mx-2"></div>
                <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0 no-scrollbar">
                  {(['All', 'Open', 'Closed', 'Maintenance'] as const).map((c) => (
                    <Button
                      key={c}
                      variant={chip === c ? "default" : "ghost"}
                      onClick={() => setChip(c)}
                      className={`gap-2 ${chip === c ? '' : 'text-muted-foreground'}`}
                    >
                      {c === 'Open' && <div className="w-2 h-2 rounded-full bg-emerald-500" />}
                      {c === 'Closed' && <div className="w-2 h-2 rounded-full bg-destructive" />}
                      {c === 'Maintenance' && <span className="material-symbols-outlined text-[16px]">build</span>}
                      {c}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* Branch Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 pb-12">
              {loading ? (
                <div className="col-span-full py-20 text-center text-muted-foreground">Loading branches...</div>
              ) : error ? (
                <div className="col-span-full flex flex-col items-center justify-center py-20 gap-4">
                  <div className="text-destructive font-medium">{error}</div>
                  <Button variant="outline" onClick={fetchBranches}>Retry</Button>
                </div>
              ) : visible.length === 0 ? (
                <div className="col-span-full flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
                  <div>No branches found matching your criteria.</div>
                  <Button variant="outline" onClick={fetchBranches}>Refresh</Button>
                </div>
              ) : null}

              {visible.map((b) => {
                const status = (b.status || 'Open') as string;
                const isOpen = status.toLowerCase() === 'open';
                const isClosed = status.toLowerCase() === 'closed';
                const isMaint = status.toLowerCase() === 'maintenance';
                const location = [b.city, b.address].map((x) => (x || '').trim()).filter(Boolean).join('    ');

                return (
                  <Card
                    key={b.id}
                    onClick={() => selectBranch(b.id)}
                    className={`group cursor-pointer overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:border-primary/50 ${isMaint ? 'opacity-70' : ''}`}
                  >
                    <div className="relative w-full aspect-video bg-muted overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/30 to-transparent"></div>
                      {/* Status Badge */}
                      <div className="absolute top-3 right-3">
                        <div className={`backdrop-blur-md px-2.5 py-1 rounded-full flex items-center gap-1.5 border font-bold text-xs uppercase tracking-wide text-foreground ${isOpen ? 'bg-background/60 border-border' : 'bg-background/80 border-border'}`}>
                          <div className={`w-2 h-2 rounded-full ${isOpen ? 'bg-emerald-500 shadow-sm' : isClosed ? 'bg-destructive' : 'bg-orange-500'}`}></div>
                          {status}
                        </div>
                      </div>
                      {/* Avatar/Initial */}
                      <div className="absolute bottom-4 left-4 text-foreground">
                        <div className="h-12 w-12 rounded-xl bg-background/40 backdrop-blur-md flex items-center justify-center text-2xl font-black border border-border shadow-lg">
                          {b.name.slice(0, 1).toUpperCase()}
                        </div>
                      </div>
                    </div>
                    <CardContent className="p-5">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-bold text-lg leading-tight group-hover:text-primary transition-colors">{b.name}</h3>
                        <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors -mr-2 -mt-2">
                          <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                        </div>
                      </div>

                      <div className="space-y-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[18px]">badge</span>
                          <span>Manager: <span className="text-foreground font-medium">{b.managerName || '  '}</span></span>
                        </div>
                        {location && (
                          <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px]">location_on</span>
                            <span className="truncate">{location}</span>
                          </div>
                        )}
                        {b.phone && (
                          <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px]">call</span>
                            <span>{b.phone}</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={createOpen}
        onOpenChange={(v) => !creating && setCreateOpen(v)}
        title="Create New Branch"
        description="Add a new location to your network."
        footer={
          <div className="flex justify-end gap-3 w-full">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={createBranch} disabled={creating}>{creating ? 'Creating...' : 'Create Branch'}</Button>
          </div>
        }
      >
        <div className="grid gap-4 py-4">
          {error && <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md border border-destructive/20">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Branch Name *</Label>
              <Input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder="Downtown Hub" />
            </div>
            <div className="grid gap-2">
              <Label>Manager Name</Label>
              <Input value={createForm.managerName} onChange={e => setCreateForm({ ...createForm, managerName: e.target.value })} placeholder="Sarah Jenkins" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>City</Label>
              <Input value={createForm.city} onChange={e => setCreateForm({ ...createForm, city: e.target.value })} placeholder="Addis Ababa" />
            </div>
            <div className="grid gap-2">
              <Label>Phone</Label>
              <Input value={createForm.phone} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })} placeholder="+251..." />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Address</Label>
            <Input value={createForm.address} onChange={e => setCreateForm({ ...createForm, address: e.target.value })} placeholder="Street, building..." />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={createForm.status} onChange={e => setCreateForm({ ...createForm, status: e.target.value as any })}>
                <option value="Open">Open</option>
                <option value="Closed">Closed</option>
                <option value="Maintenance">Maintenance</option>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Rating (0-5)</Label>
              <Input type="number" min={0} max={5} step={0.1} value={createForm.rating} onChange={e => setCreateForm({ ...createForm, rating: e.target.value })} />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};