import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';

type SupportStats = {
  totalOpen: number;
  slaBreaches: number;
  avgResponseMin: number;
  todayVolume: number;
};

type SupportTicketRow = {
  id: string;
  severity: string;
  subject: string;
  status: string;
  tenantId: string;
  createdAt: string;
  slaRemainingSec: number;
  slaBreached: boolean;
  clientName: string;
};

type SupportActivity = { id: string; by: string; at: string; message: string };

type SupportTicketDetail = {
  id: string;
  tenantId: string;
  severity: string;
  subject: string;
  status: string;
  reportedByRole: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  client: { name: string; tier: string; initials: string; ltvEtb: number; healthPct: number };
  activity: SupportActivity[];
};

const fmtMins = (mins: number) => {
  if (!Number.isFinite(mins)) return ' ”';
  if (mins < 60) return `${Math.max(0, Math.round(mins))}m`;
  const h = Math.floor(mins / 60);
  const m = Math.max(0, Math.round(mins - h * 60));
  return `${h}h ${m}m`;
};

const fmtAgo = (iso: string) => {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  const m = mins - h * 60;
  return `${h}h ${m}m ago`;
};

const fmtSla = (sec: number, breached: boolean) => {
  if (breached) return { text: 'BREACHED', className: 'text-[#ef4444] font-mono text-sm font-bold' };
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const text = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} rem`;
  const warn = s < 60 * 60;
  return {
    text,
    className: warn ? 'text-[#eead2b] font-mono text-sm font-bold' : 'text-[#c9b792] font-mono text-sm',
  };
};

const severityBadge = (sev: string) => {
  const s = String(sev || '').toLowerCase();
  if (s === 'critical') return 'border-[#ef4444] text-[#ef4444] bg-[#ef4444]/10';
  if (s === 'high') return 'border-[#eead2b] text-[#eead2b] bg-[#eead2b]/5';
  if (s === 'medium') return 'border-[#c9b792] text-[#c9b792] bg-[#c9b792]/5';
  return 'border-[#483c23] text-[#c9b792] bg-[#483c23]/10';
};

const severityDot = (sev: string) => {
  const s = String(sev || '').toLowerCase();
  if (s === 'critical') return 'bg-[#ef4444]';
  if (s === 'high') return 'bg-[#eead2b]';
  return 'bg-[#c9b792]';
};

export const SA_Support: React.FC = () => {
  const [stats, setStats] = useState<SupportStats>({ totalOpen: 0, slaBreaches: 0, avgResponseMin: 12, todayVolume: 0 });
  const [tickets, setTickets] = useState<SupportTicketRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [selected, setSelected] = useState<SupportTicketDetail | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/superadmin/support');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setStats({
        totalOpen: Number(json?.stats?.totalOpen || 0),
        slaBreaches: Number(json?.stats?.slaBreaches || 0),
        avgResponseMin: Number(json?.stats?.avgResponseMin || 12),
        todayVolume: Number(json?.stats?.todayVolume || 0),
      });
      const nextTickets = Array.isArray(json?.tickets) ? (json.tickets as SupportTicketRow[]) : [];
      setTickets(nextTickets);
      if (!selectedId && nextTickets.length > 0) setSelectedId(String(nextTickets[0]?.id || ''));
    } catch (e: any) {
      setError(String(e?.message || 'Failed to load support desk'));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const loadTicket = useCallback(async (id: string) => {
    const tid = String(id || '');
    if (!tid) return;
    setLoadingDetail(true);
    setError('');
    try {
      const res = await apiFetch(`/api/superadmin/support/tickets/${encodeURIComponent(tid)}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setSelected((json?.ticket || null) as SupportTicketDetail | null);
    } catch (e: any) {
      setSelected(null);
      setError(String(e?.message || 'Failed to load ticket'));
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (!selectedId) return;
    loadTicket(selectedId);
  }, [selectedId, loadTicket]);

  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter((t) => {
      const id = String(t.id || '').toLowerCase();
      const subject = String(t.subject || '').toLowerCase();
      const client = String(t.clientName || '').toLowerCase();
      return id.includes(q) || subject.includes(q) || client.includes(q);
    });
  }, [search, tickets]);

  const onReply = useCallback(async () => {
    const msg = reply.trim();
    if (!msg || !selectedId) return;
    setError('');
    try {
      const res = await apiFetch(`/api/superadmin/support/tickets/${encodeURIComponent(selectedId)}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setReply('');
      await loadTicket(selectedId);
      await loadOverview();
    } catch (e: any) {
      setError(String(e?.message || 'Failed to post reply'));
    }
  }, [loadOverview, loadTicket, reply, selectedId]);

  const setTicketStatus = useCallback(
    async (status: 'open' | 'in_progress' | 'waiting_client' | 'closed') => {
      if (!selectedId || saving) return;
      setSaving(true);
      setError('');
      try {
        const res = await apiFetch(`/api/superadmin/support/tickets/${encodeURIComponent(selectedId)}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        await loadTicket(selectedId);
        await loadOverview();
      } catch (e: any) {
        setError(String(e?.message || 'Failed to update status'));
      } finally {
        setSaving(false);
      }
    },
    [loadOverview, loadTicket, saving, selectedId],
  );

  return (
    <div className="flex flex-col h-full min-w-0 bg-[#1a150c] overflow-hidden text-white">
      {/* Top Header */}
      <header className="h-16 border-b border-[#483c23] bg-[#221c10] flex items-center justify-between px-6 shrink-0">
        <h2 className="text-white text-lg font-bold tracking-tight">Support Desk</h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button className="size-9 flex items-center justify-center rounded text-[#c9b792] hover:bg-[#3a2f1b] hover:text-white transition-colors relative">
              <span className="material-symbols-outlined text-[20px]">notifications</span>
              <span className="absolute top-2 right-2 size-2 bg-[#eead2b] rounded-full border border-[#221c10]"></span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout: Grid + Detail Panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Side: Filters & List */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-[#483c23] overflow-hidden">
          {/* Stats Bar */}
          <div className="grid grid-cols-4 gap-4 px-6 py-5 bg-[#221c10] shrink-0 border-b border-[#352c1a]">
            <div className="flex flex-col gap-1">
              <span className="text-[#c9b792] text-xs uppercase tracking-wider font-semibold">Total Open</span>
              <span className="text-white text-2xl font-bold font-mono">{stats.totalOpen}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[#c9b792] text-xs uppercase tracking-wider font-semibold">SLA Breaches</span>
              <span className="text-[#ef4444] text-2xl font-bold font-mono">{stats.slaBreaches}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[#c9b792] text-xs uppercase tracking-wider font-semibold">Avg Response</span>
              <span className="text-[#eead2b] text-2xl font-bold font-mono">{fmtMins(stats.avgResponseMin)}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[#c9b792] text-xs uppercase tracking-wider font-semibold">Today's Volume</span>
              <span className="text-white text-2xl font-bold font-mono">{stats.todayVolume}</span>
            </div>
          </div>
          {/* Toolbar */}
          <div className="px-6 py-3 bg-[#221c10] border-b border-[#352c1a] flex flex-wrap items-center gap-3 shrink-0">
            <div className="relative flex-1 min-w-[240px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c9b792] material-symbols-outlined text-[18px]">search</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 pl-9 pr-4 bg-[#2c2417] border border-[#483c23] rounded text-sm text-white placeholder-[#c9b792] focus:ring-1 focus:ring-[#eead2b] focus:border-[#eead2b] transition-all"
                placeholder="Search ID, Subject, or Client..."
                type="text"
              />
            </div>
          </div>
          {/* Table Header */}
          <div className="flex bg-[#2c2417] border-b border-[#483c23] px-6 py-2 text-xs font-semibold text-[#c9b792] uppercase tracking-wider shrink-0 select-none">
            <div className="w-20">ID</div>
            <div className="w-24">Severity</div>
            <div className="flex-1">Subject</div>
            <div className="w-32 text-right">SLA Timer</div>
            <div className="w-32 text-right pl-4">Status</div>
          </div>
          {/* Table Body */}
          <div className="overflow-y-auto flex-1 bg-[#221c10]">
            {error && (
              <div className="px-6 py-4 text-sm text-[#ef4444]">{error}</div>
            )}
            {!error && loading && (
              <div className="px-6 py-4 text-sm text-[#c9b792]">Loading ¦</div>
            )}
            {!error && !loading && filteredTickets.length === 0 && (
              <div className="px-6 py-4 text-sm text-[#c9b792]">No tickets found.</div>
            )}
            {!error && filteredTickets.map((t) => {
              const isActive = String(selectedId) === String(t.id);
              const sev = String(t.severity || 'Low');
              const sla = fmtSla(Number(t.slaRemainingSec || 0), Boolean(t.slaBreached));
              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedId(String(t.id))}
                  className={`group flex items-center px-6 py-3 border-b border-[#352c1a] ${isActive ? 'bg-[#2c2417] border-l-4 border-l-[#eead2b] hover:bg-[#352c1a]' : 'hover:bg-[#2c2417] border-l-4 border-l-transparent'} cursor-pointer transition-colors`}
                >
                  <div className={`w-20 font-mono text-sm ${isActive ? 'text-white' : 'text-[#c9b792]'}`}>#{t.id}</div>
                  <div className="w-24">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wide ${severityBadge(sev)}`}>{sev}</span>
                  </div>
                  <div className="flex-1 pr-4">
                    <p className="text-white text-sm font-medium truncate">{t.subject}</p>
                    <p className="text-[#c9b792] text-xs truncate lg:hidden">{t.clientName}</p>
                  </div>
                  <div className="w-32 text-right">
                    <span className={sla.className}>{sla.text}</span>
                  </div>
                  <div className="w-32 text-right pl-4">
                    <span className={`${isActive ? 'text-white text-xs bg-[#483c23] px-2 py-1 rounded' : 'text-[#c9b792] text-xs border border-[#483c23] px-2 py-1 rounded'}`}>{t.status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: Details Panel */}
        <div className="w-[480px] shrink-0 bg-[#221c10] border-l border-[#483c23] flex flex-col h-full shadow-xl z-10 hidden md:flex">
          <div className="h-14 px-6 border-b border-[#352c1a] flex items-center justify-between shrink-0 bg-[#2c2417]">
            <div className="flex items-center gap-3">
              <span className="text-[#c9b792] font-mono text-sm">#{selected?.id || selectedId || ' ”'}</span>
              <span className="w-px h-4 bg-[#483c23]"></span>
              <div className="flex items-center gap-2">
                <div className={`size-2 rounded-full ${severityDot(selected?.severity || '')}`}></div>
                <span className="text-white text-sm font-semibold">{selected?.severity || ' ”'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={saving || !selectedId || String(selected?.status || '') === 'open'}
                onClick={() => setTicketStatus('open')}
                className="h-8 px-2.5 rounded border border-[#483c23] bg-[#221c10] text-[#c9b792] text-[11px] font-bold hover:bg-[#352c1a] hover:text-white disabled:opacity-50"
                type="button"
              >
                Open
              </button>
              <button
                disabled={saving || !selectedId || String(selected?.status || '') === 'in_progress'}
                onClick={() => setTicketStatus('in_progress')}
                className="h-8 px-2.5 rounded border border-[#483c23] bg-[#221c10] text-[#c9b792] text-[11px] font-bold hover:bg-[#352c1a] hover:text-white disabled:opacity-50"
                type="button"
              >
                In Progress
              </button>
              <button
                disabled={saving || !selectedId || String(selected?.status || '') === 'waiting_client'}
                onClick={() => setTicketStatus('waiting_client')}
                className="h-8 px-2.5 rounded border border-[#483c23] bg-[#221c10] text-[#c9b792] text-[11px] font-bold hover:bg-[#352c1a] hover:text-white disabled:opacity-50"
                type="button"
              >
                Waiting
              </button>
              <button
                disabled={saving || !selectedId || String(selected?.status || '') === 'closed'}
                onClick={() => setTicketStatus('closed')}
                className="h-8 px-2.5 rounded bg-[#eead2b] text-[#221c10] text-[11px] font-black hover:bg-[#d6961b] disabled:opacity-50"
                type="button"
              >
                Close
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <h3 className="text-white text-lg font-bold leading-tight mb-2">{selected?.subject || (loadingDetail ? 'Loading ¦' : 'Select a ticket')}</h3>
              <div className="flex items-center gap-2 text-[#c9b792] text-xs">
                <span className="material-symbols-outlined text-[16px]">schedule</span>
                <span>{selected?.createdAt ? `Reported ${fmtAgo(selected.createdAt)} by ${selected?.reportedByRole || 'Client'}` : ' ”'}</span>
              </div>
            </div>
            <div className="bg-[#2c2417] border border-[#483c23] rounded p-4">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded bg-[#3a2f1b] bg-center bg-cover flex items-center justify-center text-[#c9b792] font-bold">{selected?.client?.initials || ' ”'}</div>
                  <div>
                    <p className="text-white font-bold text-sm">{selected?.client?.name || ' ”'}</p>
                    <p className="text-[#eead2b] text-xs font-medium">{selected?.client?.tier ? `${selected.client.tier} Tier` : ' ”'}</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-2 bg-[#221c10] rounded border border-[#352c1a]">
                  <p className="text-[10px] text-[#c9b792] uppercase tracking-wider">LTV</p>
                  <p className="text-white font-mono text-sm">ETB {selected?.client?.ltvEtb?.toLocaleString?.() ?? ' ”'}</p>
                </div>
                <div className="p-2 bg-[#221c10] rounded border border-[#352c1a]">
                  <p className="text-[10px] text-[#c9b792] uppercase tracking-wider">Health</p>
                  <p className="text-[#4ade80] font-mono text-sm">{typeof selected?.client?.healthPct === 'number' ? `${selected.client.healthPct}%` : ' ”'}</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-[#c9b792] uppercase tracking-wider font-semibold">Description</p>
              <p className="text-sm text-[#e0e0e0] leading-relaxed">
                {selected?.description || ' ”'}
              </p>
            </div>
            <div className="space-y-4 pt-4 border-t border-[#352c1a]">
              <p className="text-xs text-[#c9b792] uppercase tracking-wider font-semibold">Activity Log</p>
              {(selected?.activity || []).length === 0 && (
                <div className="text-xs text-[#c9b792]">No activity yet.</div>
              )}
              {(selected?.activity || []).map((a, idx) => (
                <div key={a.id || idx} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="size-6 rounded-full bg-[#352c1a] flex items-center justify-center text-[#c9b792]">
                      <span className="material-symbols-outlined text-[14px]">{String(a.by || '').toLowerCase().includes('system') ? 'smart_toy' : 'support_agent'}</span>
                    </div>
                    <div className="w-px h-full bg-[#352c1a] my-1"></div>
                  </div>
                  <div className="pb-4">
                    <div className="text-xs flex gap-2 items-center mb-1">
                      <span className="text-white font-semibold">{a.by || 'System'}</span>
                      <span className="text-[#c9b792]">{a.at ? fmtAgo(a.at) : ''}</span>
                    </div>
                    <p className="text-xs text-[#c9b792]">{a.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="p-4 bg-[#2c2417] border-t border-[#352c1a] shrink-0">
            <div className="flex gap-2">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                className="flex-1 h-10 bg-[#221c10] border border-[#483c23] rounded px-3 text-sm text-white placeholder-[#c9b792] focus:ring-1 focus:ring-[#eead2b] focus:border-[#eead2b]"
                placeholder="Type an internal note or reply..."
                type="text"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onReply();
                }}
              />
              <button onClick={onReply} className="h-10 px-4 bg-[#eead2b] hover:bg-[#d6961b] text-[#221c10] font-bold text-sm rounded transition-colors">
                Reply
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
