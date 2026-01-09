import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { OwnerPageHeader } from '../../components/OwnerPageHeader';
import { formatDeviceDateTime } from '../../datetime';

type MyTicketRow = {
  id: string;
  severity: string;
  subject: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

const fmtTime = (iso: string) => {
  const out = formatDeviceDateTime(iso, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  return out || ' ”';
};

export const SupportRequest: React.FC = () => {
  const [severity, setSeverity] = useState('High');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  const [tickets, setTickets] = useState<MyTicketRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadMine = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/support/tickets');
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const rows = Array.isArray(json?.tickets) ? (json.tickets as MyTicketRow[]) : [];
      setTickets(rows);
    } catch (e: any) {
      setError(String(e?.message || 'Failed to load tickets'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  const onSubmit = useCallback(async () => {
    const s = subject.trim();
    const d = description.trim();
    if (!s || !d) {
      setError(!s ? 'Subject is required.' : 'Description is required.');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const res = await apiFetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ severity, subject: s, description: d }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const ticketId = String(json?.ticketId || '');
      setSubject('');
      setDescription('');
      setSuccess(ticketId ? `Ticket #${ticketId} submitted.` : 'Ticket submitted.');
      await loadMine();
    } catch (e: any) {
      setError(String(e?.message || 'Failed to submit ticket'));
    } finally {
      setSubmitting(false);
    }
  }, [description, loadMine, severity, subject]);

  const updateTicketStatus = useCallback(
    async (id: string, status: 'Open' | 'Closed') => {
      if (!id) return;
      setError('');
      setSuccess('');
      try {
        const res = await apiFetch(`/api/support/tickets/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        setSuccess(status === 'Closed' ? `Ticket #${id} closed.` : `Ticket #${id} reopened.`);
        await loadMine();
      } catch (e: any) {
        setError(String(e?.message || 'Failed to update ticket'));
      }
    },
    [loadMine],
  );

  const sortedTickets = useMemo(() => {
    return tickets
      .slice()
      .sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime());
  }, [tickets]);

  return (
    <div className="flex flex-col h-full min-w-0 bg-white dark:bg-[#181611] overflow-hidden">
      <OwnerPageHeader
        title="Request Support"
        leftSlot={<div className="text-xs text-[#b9b09d]">Submit an issue to the MirachPOS Support Desk.</div>}
        rightSlot={
          <button
            onClick={loadMine}
            className="flex items-center gap-2 h-10 px-4 rounded-lg bg-[#393328] text-white text-sm font-bold hover:bg-[#393328]/80 transition-colors"
            type="button"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
              refresh
            </span>
            Refresh
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-[#1e1910] border border-slate-200 dark:border-[#483c23] rounded-xl p-5">
            <h3 className="text-slate-900 dark:text-white font-bold text-sm uppercase tracking-wider">New Ticket</h3>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#c9b792] mb-2">Severity</label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  className="w-full h-10 rounded-lg bg-white dark:bg-[#221c10] border border-slate-200 dark:border-[#483c23] text-slate-900 dark:text-white px-3 text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                >
                  <option value="Critical">Critical</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#c9b792] mb-2">Subject</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g., Payment timeout on POS"
                  className="w-full h-10 rounded-lg bg-white dark:bg-[#221c10] border border-slate-200 dark:border-[#483c23] text-slate-900 dark:text-white px-3 text-sm placeholder:text-slate-400 dark:placeholder:text-[#c9b792] focus:ring-2 focus:ring-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#c9b792] mb-2">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what happened, when it started, and what you tried."
                  className="w-full min-h-[120px] rounded-lg bg-white dark:bg-[#221c10] border border-slate-200 dark:border-[#483c23] text-slate-900 dark:text-white p-3 text-sm placeholder:text-slate-400 dark:placeholder:text-[#c9b792] focus:ring-2 focus:ring-primary focus:outline-none"
                />
              </div>

              {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
              {success && <div className="text-sm text-green-700 dark:text-green-400">{success}</div>}

              <button
                onClick={onSubmit}
                disabled={submitting}
                className="w-full h-11 rounded-lg bg-primary text-white font-bold text-sm hover:opacity-90 disabled:opacity-60 transition-opacity"
              >
                {submitting ? 'Submitting ¦' : 'Submit Ticket'}
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-[#1e1910] border border-slate-200 dark:border-[#483c23] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-[#483c23] flex items-center justify-between">
              <h3 className="text-slate-900 dark:text-white font-bold text-sm uppercase tracking-wider">My Tickets</h3>
              <span className="text-xs text-slate-500 dark:text-[#c9b792] font-mono">{loading ? 'Loading ¦' : `${tickets.length} total`}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="bg-slate-50 dark:bg-[#221c10]">
                  <tr className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#c9b792]">
                    <th className="px-5 py-3">ID</th>
                    <th className="px-5 py-3">Severity</th>
                    <th className="px-5 py-3">Subject</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Created</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-[#483c23]">
                  {!loading && sortedTickets.length === 0 && (
                    <tr>
                      <td className="px-5 py-4 text-sm text-slate-500 dark:text-[#c9b792]" colSpan={6}>No tickets yet.</td>
                    </tr>
                  )}
                  {sortedTickets.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-[#2c2417] transition-colors">
                      <td className="px-5 py-3 text-sm font-mono text-slate-900 dark:text-white">#{t.id}</td>
                      <td className="px-5 py-3 text-sm text-slate-700 dark:text-[#c9b792]">{t.severity}</td>
                      <td className="px-5 py-3 text-sm text-slate-900 dark:text-white max-w-[260px] truncate">{t.subject}</td>
                      <td className="px-5 py-3 text-sm text-slate-700 dark:text-[#c9b792]">{t.status}</td>
                      <td className="px-5 py-3 text-sm text-slate-700 dark:text-[#c9b792]">{fmtTime(t.createdAt)}</td>
                      <td className="px-5 py-3 text-sm text-right">
                        {String(t.status) === 'Closed' ? (
                          <button
                            onClick={() => updateTicketStatus(t.id, 'Open')}
                            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-[#483c23] text-xs font-bold text-slate-700 dark:text-[#c9b792] hover:bg-slate-50 dark:hover:bg-[#2c2417] transition-colors"
                            type="button"
                          >
                            Reopen
                          </button>
                        ) : (
                          <button
                            onClick={() => updateTicketStatus(t.id, 'Closed')}
                            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-[#483c23] text-xs font-bold text-slate-700 dark:text-[#c9b792] hover:bg-slate-50 dark:hover:bg-[#2c2417] transition-colors"
                            type="button"
                          >
                            Close
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
