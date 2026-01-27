import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { Screen } from '../../types';
import { Header } from '../../components/Header';
import { formatDeviceDateTime } from '../../datetime';

import { AppIcon } from '@/components/ui/app-icon';
export const OwnerAudit: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const branchParam = selectedBranchId === 'ALL' ? '' : selectedBranchId;
      const auditUrl = `/api/audit/list${branchParam ? `?branchId=${encodeURIComponent(branchParam)}` : ''}`;
      const [auditRes, brRes] = await Promise.all([
        apiFetch(auditUrl),
        apiFetch('/api/branches')
      ]);

      const auditJson = await auditRes.json();
      const brJson = await brRes.json();

      const branchList = Array.isArray(brJson?.branches) ? brJson.branches : [];
      const branchNameById = new Map<string, string>();
      for (const b of branchList) {
        const id = String(b?.id || '').trim();
        const name = String(b?.name || '').trim();
        if (id) branchNameById.set(id, name || id);
      }

      if (!auditRes.ok) throw new Error(auditJson?.error || 'Forensic sync failed');

      const rows = Array.isArray(auditJson?.audit) ? auditJson.audit : [];
      const normalized = rows.map((e: any) => ({
        id: e.id,
        createdAt: e.at,
        type: e.type,
        staffName: e.actorName || e.actorEmail || 'System',
        branchName: e.branchId ? (branchNameById.get(String(e.branchId)) || String(e.branchId)) : 'Global',
        summary:
          (typeof e.summary === 'string' && e.summary.trim())
            ? e.summary
            : e.payload != null
              ? JSON.stringify(e.payload)
              : '',
      }));
      setEvents(normalized);
      setBranches(branchList);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Auditor node offline');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [selectedBranchId]);

  const filtered = useMemo(() => {
    if (!search) return events;
    const q = search.toLowerCase();
    return events.filter(e =>
      String(e.type || '').toLowerCase().includes(q) ||
      String(e.summary || '').toLowerCase().includes(q) ||
      String(e.staffName || '').toLowerCase().includes(q) ||
      String(e.branchName || '').toLowerCase().includes(q)
    );
  }, [events, search]);

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      <Header
        title="Audit Log"
        subtitle="Track important actions in your system"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative w-[240px]">
              <AppIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-[18px]" size={18} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-10 rounded-xl border border-border bg-background pl-10 pr-10 text-sm text-foreground focus:border-primary focus:outline-none placeholder:text-muted-foreground"
                placeholder="Search audit..."
                type="text"
              />
              {search.trim() ? (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
                  type="button"
                  title="Clear"
                >
                  <AppIcon name="close" className="text-[18px]" size={18} />
                </button>
              ) : null}
            </div>

            <div className="flex items-center rounded-xl border border-border bg-background px-2 h-10">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-2">Branch</span>
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="h-9 bg-transparent text-sm text-foreground focus:ring-0 border-none"
              >
                <option value="ALL">All</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={load}
              className="h-10 px-4 rounded-xl border border-border bg-background text-foreground font-black text-sm hover:bg-accent hover:border-primary/50 flex items-center gap-2"
              type="button"
            >
              <AppIcon name="sync" className={`text-[18px] ${loading ? 'animate-spin' : ''}`} size={18} />
              Refresh
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-6 lg:p-10 space-y-6 pb-32">
          {error ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/10 text-destructive p-4 flex items-center justify-between gap-4">
              <div className="text-sm">{error}</div>
              <button onClick={load} className="h-10 px-4 rounded-lg bg-background border border-border text-foreground hover:bg-accent hover:border-primary/50" type="button">
                Retry
              </button>
            </div>
          ) : null}

          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-6 py-4">
              <div className="flex items-center gap-2">
                <AppIcon name="policy" className="text-primary text-[20px]" size={20} />
                <div className="text-foreground font-black">Audit Events</div>
              </div>
              <div className="text-xs text-muted-foreground">Showing {filtered.length}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground border-b border-border">
                  <tr>
                    <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider">Time</th>
                    <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider">Action</th>
                    <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider">Actor</th>
                    <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider">Branch</th>
                    <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((e: any, idx: number) => (
                    <tr key={e.id || idx} className={idx % 2 === 1 ? 'bg-muted/20 hover:bg-accent/50 transition-colors' : 'hover:bg-accent/50 transition-colors'}>
                      <td className="whitespace-nowrap px-6 py-3 text-muted-foreground font-mono text-[12px]">
                        {e.createdAt ? formatDeviceDateTime(e.createdAt) : '—'}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-foreground font-black">{String(e.type || '').replace(/_/g, ' ') || '—'}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{e.staffName || 'System'}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{e.branchName || 'Global'}</td>
                      <td className="px-6 py-3 text-muted-foreground">
                        <div className="max-w-[640px] truncate" title={e.summary || ''}>{e.summary || '—'}</div>
                      </td>
                    </tr>
                  ))}

                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-muted-foreground text-sm">
                        No audit events found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OwnerAudit;