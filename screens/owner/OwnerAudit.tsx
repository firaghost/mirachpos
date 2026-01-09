import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { Screen } from '../../types';
import { Header } from '../../components/Header';
import { formatDeviceDateTime } from '../../datetime';

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

      if (!auditRes.ok) throw new Error(auditJson?.error || 'Forensic sync failed');

      const rows = Array.isArray(auditJson?.audit) ? auditJson.audit : [];
      const normalized = rows.map((e: any) => ({
        id: e.id,
        createdAt: e.at,
        type: e.type,
        staffName: e.actorName || e.actorEmail || 'System',
        branchName: e.branchId || 'Global',
        summary:
          (typeof e.summary === 'string' && e.summary.trim())
            ? e.summary
            : e.payload != null
              ? JSON.stringify(e.payload)
              : '',
      }));
      setEvents(normalized);
      setBranches(brJson?.branches || []);
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
    <div className="flex flex-col h-full bg-[#0f0d08] overflow-hidden">
      <Header
        title="Audit Log"
        subtitle="Track important actions in your system"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="relative w-[240px]">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#c9b792] text-[18px]">search</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-10 rounded-xl border border-[#483c23] bg-[#221c11] pl-10 pr-10 text-sm text-white focus:border-primary focus:outline-none placeholder:text-[#c9b792]/60"
                placeholder="Search audit..."
                type="text"
              />
              {search.trim() ? (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-[#483c23] text-[#c9b792] hover:text-white"
                  type="button"
                  title="Clear"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              ) : null}
            </div>

            <div className="flex items-center rounded-xl border border-[#483c23] bg-[#221c11] px-2 h-10">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#c9b792] mr-2">Branch</span>
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="h-9 bg-transparent text-sm text-white focus:ring-0 border-none"
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
              className="h-10 px-4 rounded-xl border border-[#483c23] bg-[#221c11] text-white font-black text-sm hover:border-primary/50 flex items-center gap-2"
              type="button"
            >
              <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>sync</span>
              Refresh
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-6 lg:p-10 space-y-6 pb-32">
          {error ? (
            <div className="rounded-xl border border-red-500/20 bg-red-900/10 text-red-300 p-4 flex items-center justify-between gap-4">
              <div className="text-sm">{error}</div>
              <button onClick={load} className="h-10 px-4 rounded-lg bg-[#2a2316] border border-[#483c23] text-white hover:border-primary/50" type="button">
                Retry
              </button>
            </div>
          ) : null}

          <div className="rounded-2xl border border-[#483c23] bg-[#2a2316] overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-[#483c23] bg-[#221c11] px-6 py-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">policy</span>
                <div className="text-white font-black">Audit Events</div>
              </div>
              <div className="text-xs text-[#c9b792]">Showing {filtered.length}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#221c11] text-xs uppercase text-[#c9b792] border-b border-[#483c23]">
                  <tr>
                    <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider">Time</th>
                    <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider">Action</th>
                    <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider">Actor</th>
                    <th className="whitespace-nowrap px-5 py-3 font-bold tracking-wider">Branch</th>
                    <th className="whitespace-nowrap px-6 py-3 font-bold tracking-wider">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#483c23]">
                  {filtered.map((e: any, idx: number) => (
                    <tr key={e.id || idx} className={idx % 2 === 1 ? 'bg-[#221c11]/30 hover:bg-[#322a1b] transition-colors' : 'hover:bg-[#322a1b] transition-colors'}>
                      <td className="whitespace-nowrap px-6 py-3 text-[#c9b792] font-mono text-[12px]">
                        {e.createdAt ? formatDeviceDateTime(e.createdAt) : '—'}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-white font-black">{String(e.type || '').replace(/_/g, ' ') || '—'}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-[#c9b792]">{e.staffName || 'System'}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-[#c9b792]">{e.branchName || 'Global'}</td>
                      <td className="px-6 py-3 text-[#c9b792]">
                        <div className="max-w-[640px] truncate" title={e.summary || ''}>{e.summary || '—'}</div>
                      </td>
                    </tr>
                  ))}

                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-[#c9b792] text-sm">
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