import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { formatDeviceDateTime } from '../../datetime';
import { PortalMenu } from '../../components/PortalMenu';

type DemoRequest = {
  id: string;
  status: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  country: string;
  source: string;
  message: string;
  provisionedTenantId: string;
  createdAt: string;
  processedAt: string;
};

const slugify = (v: string) =>
  String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 48);

export const SA_DemoRequests: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('All');
  const [items, setItems] = useState<DemoRequest[]>([]);

  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [filterAnchor, setFilterAnchor] = useState<any>(null);

  const [provisionOpen, setProvisionOpen] = useState(false);
  const [provisionReqId, setProvisionReqId] = useState('');
  const [provisionSlug, setProvisionSlug] = useState('');
  const [provisionTenantName, setProvisionTenantName] = useState('');
  const [provisionOwnerName, setProvisionOwnerName] = useState('');
  const [provisionBranchName, setProvisionBranchName] = useState('Main Branch');
  const [provisionTrialDays, setProvisionTrialDays] = useState('7');
  const [provisionOwnerPassword, setProvisionOwnerPassword] = useState('');
  const [provisionSaving, setProvisionSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (status.trim() && status !== 'All') qs.set('status', status.trim());
      if (q.trim()) qs.set('q', q.trim());
      const url = `/api/superadmin/demo-requests${qs.toString() ? `?${qs.toString()}` : ''}`;
      const res = await apiFetch(url);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const list = Array.isArray(json?.demoRequests) ? json.demoRequests : [];
      setItems(list as DemoRequest[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load demo requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((x) => x.name.toLowerCase().includes(s) || x.email.toLowerCase().includes(s) || x.company.toLowerCase().includes(s));
  }, [items, q]);

  const openProvision = (d: DemoRequest) => {
    setError(null);
    setToast(null);
    setProvisionReqId(d.id);
    setProvisionTenantName(d.company || `${d.name}'s Cafe`);
    setProvisionOwnerName(d.name || 'Owner');
    setProvisionBranchName('Main Branch');
    setProvisionSlug(slugify(d.company || d.name || 'cafe'));
    setProvisionTrialDays('7');
    setProvisionOwnerPassword('');
    setProvisionOpen(true);
  };

  const markStatus = async (id: string, nextStatus: string) => {
    setError(null);
    setToast(null);
    try {
      const res = await apiFetch(`/api/superadmin/demo-requests/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setToast('Updated');
      setTimeout(() => setToast(null), 2500);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update request');
    }
  };

  const openStatusFilter = (ev: React.MouseEvent) => {
    const next = !filterMenuOpen;
    setFilterMenuOpen(next);
    if (!next) {
      setFilterAnchor(null);
      return;
    }
    try {
      const el = (ev?.currentTarget as any) || null;
      const r = el?.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (r) setFilterAnchor({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
      else setFilterAnchor(null);
    } catch {
      setFilterAnchor(null);
    }
  };

  const provision = async () => {
    if (provisionSaving) return;
    setProvisionSaving(true);
    setError(null);
    setToast(null);
    try {
      const reqId = provisionReqId.trim();
      if (!reqId) throw new Error('Missing request id');
      const slug = provisionSlug.trim();
      const tenantName = provisionTenantName.trim();
      const ownerName = provisionOwnerName.trim();
      const branchName = provisionBranchName.trim();
      const ownerPassword = provisionOwnerPassword;
      const trialDays = Number(provisionTrialDays || 7);

      if (!slug) throw new Error('Slug is required');
      if (!tenantName) throw new Error('Tenant name is required');
      if (!ownerPassword) throw new Error('Owner password is required');

      const res = await apiFetch(`/api/superadmin/demo-requests/${encodeURIComponent(reqId)}/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, tenantName, ownerName, branchName, ownerPassword, trialDays }),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      setProvisionOpen(false);
      setToast(`Provisioned: ${String(json?.tenant?.slug || slug)}`);
      setTimeout(() => setToast(null), 5000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Provision failed');
    } finally {
      setProvisionSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#221c10] text-white">
      <header className="flex-shrink-0 px-6 py-4 border-b border-[#483c23] bg-[#221c10] z-10">
        <div className="flex flex-wrap justify-between items-end gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-white text-3xl font-bold tracking-tight">Demo Requests</h2>
            <p className="text-[#c9b792] text-sm">Incoming demo requests from the marketing website.</p>
          </div>
          <button onClick={load} className="h-10 px-4 rounded-lg border border-[#483c23] hover:bg-[#483c23] text-white text-sm font-bold">
            Refresh
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {error ? <div className="mb-4 rounded-lg border border-red-900/40 bg-red-900/10 p-4 text-sm text-red-200">{error}</div> : null}
        {toast ? <div className="mb-4 rounded-lg border border-emerald-900/40 bg-emerald-900/10 p-4 text-sm text-emerald-200">{toast}</div> : null}

        <div className="mb-4 flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-10 w-full sm:w-80 rounded-lg bg-[#2d261a] border border-[#483c23] px-3 text-sm text-white placeholder-[#c9b792]"
              placeholder="Search name/email/company"
            />
            <button
              type="button"
              onClick={openStatusFilter}
              className="h-10 w-full sm:w-52 rounded-lg bg-[#2d261a] border border-[#483c23] px-3 text-sm text-white flex items-center justify-between"
            >
              <span className="text-[#c9b792]">Status</span>
              <span className="text-white font-semibold">{status}</span>
              <span className="material-symbols-outlined text-[18px] text-[#c9b792]">expand_more</span>
            </button>
          </div>
          <div className="text-xs text-[#c9b792]">{loading ? 'Loading ¦' : `${filtered.length} requests`}</div>
        </div>

        <PortalMenu
          open={filterMenuOpen && Boolean(filterAnchor)}
          anchorRect={filterAnchor}
          onClose={() => {
            setFilterMenuOpen(false);
            setFilterAnchor(null);
          }}
          width={220}
        >
          {(['All', 'New', 'Contacted', 'Rejected', 'Provisioned'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setStatus(v);
                setFilterMenuOpen(false);
                setFilterAnchor(null);
                setTimeout(() => load(), 0);
              }}
              className="w-full text-left px-4 py-2 text-sm text-white hover:bg-[#2d261a]"
            >
              {v}
            </button>
          ))}
        </PortalMenu>

        <div className="overflow-x-auto rounded-xl border border-[#483c23]">
          <table className="min-w-full text-sm">
            <thead className="bg-[#2d261a] text-[#c9b792]">
              <tr>
                <th className="text-left px-4 py-3">Lead</th>
                <th className="text-left px-4 py-3">Company</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Created</th>
                <th className="text-left px-4 py-3">Provisioned</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="border-t border-[#483c23] bg-[#221c10]">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-white">{d.name || ' ”'}</div>
                    <div className="text-xs text-[#c9b792]">{d.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-white">{d.company || ' ”'}</div>
                    <div className="text-xs text-[#c9b792]">{d.country || ''} {d.source ? `   ${d.source}` : ''}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        'inline-flex items-center rounded-full px-2 py-1 text-xs font-bold border ' +
                        (String(d.status || '').toLowerCase() === 'new'
                          ? 'bg-[#2d261a] text-[#eead2b] border-[#eead2b]/30'
                          : String(d.status || '').toLowerCase() === 'contacted'
                            ? 'bg-blue-900/20 text-blue-300 border-blue-900/30'
                            : String(d.status || '').toLowerCase() === 'rejected'
                              ? 'bg-red-900/20 text-red-300 border-red-900/30'
                              : String(d.status || '').toLowerCase() === 'provisioned'
                                ? 'bg-green-900/20 text-green-300 border-green-900/30'
                                : 'bg-[#483c23] text-white border-[#483c23]')
                      }
                    >
                      {d.status || ' ”'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#c9b792]">{d.createdAt ? (formatDeviceDateTime(d.createdAt) || ' ”') : ' ”'}</td>
                  <td className="px-4 py-3 text-[#c9b792]">{d.provisionedTenantId ? d.provisionedTenantId : ' ”'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={String(d.status || '').toLowerCase() === 'provisioned'}
                        onClick={() => markStatus(d.id, 'Contacted')}
                        className="h-9 px-3 rounded-lg border border-[#483c23] text-xs font-bold text-[#c9b792] hover:bg-[#483c23]"
                      >
                        Mark Contacted
                      </button>
                      <button
                        type="button"
                        disabled={String(d.status || '').toLowerCase() === 'provisioned'}
                        onClick={() => markStatus(d.id, 'Rejected')}
                        className="h-9 px-3 rounded-lg border border-red-900/30 text-xs font-bold text-red-300 hover:bg-red-900/20 disabled:opacity-60"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={String(d.status || '').toLowerCase() === 'provisioned'}
                        onClick={() => markStatus(d.id, 'New')}
                        className="h-9 px-3 rounded-lg border border-[#483c23] text-xs font-bold text-[#c9b792] hover:bg-[#483c23] disabled:opacity-60"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(d.provisionedTenantId)}
                        onClick={() => openProvision(d)}
                        className="h-9 px-3 rounded-lg bg-[#eead2b] text-[#221c11] text-xs font-bold hover:bg-[#d69a25] disabled:opacity-60"
                      >
                        Provision
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[#c9b792]">
                    No demo requests
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {provisionOpen ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => (provisionSaving ? null : setProvisionOpen(false))}></div>
          <div className="relative w-full max-w-[620px] bg-[#2d261a] border border-[#483c23] rounded-xl shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-[#483c23] flex items-center justify-between">
              <div className="text-white font-bold">Provision Tenant</div>
              <button type="button" className="text-[#c9b792] hover:text-white" onClick={() => (provisionSaving ? null : setProvisionOpen(false))}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#c9b792]">Slug (subdomain)</span>
                <input value={provisionSlug} onChange={(e) => setProvisionSlug(e.target.value)} className="h-11 rounded-lg border border-[#483c23] bg-[#221c10] px-3 text-sm text-white" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#c9b792]">Tenant name</span>
                <input value={provisionTenantName} onChange={(e) => setProvisionTenantName(e.target.value)} className="h-11 rounded-lg border border-[#483c23] bg-[#221c10] px-3 text-sm text-white" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#c9b792]">Owner name</span>
                <input value={provisionOwnerName} onChange={(e) => setProvisionOwnerName(e.target.value)} className="h-11 rounded-lg border border-[#483c23] bg-[#221c10] px-3 text-sm text-white" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#c9b792]">Branch name</span>
                <input value={provisionBranchName} onChange={(e) => setProvisionBranchName(e.target.value)} className="h-11 rounded-lg border border-[#483c23] bg-[#221c10] px-3 text-sm text-white" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#c9b792]">Trial days</span>
                <input value={provisionTrialDays} onChange={(e) => setProvisionTrialDays(e.target.value)} className="h-11 rounded-lg border border-[#483c23] bg-[#221c10] px-3 text-sm text-white" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#c9b792]">Owner password (temporary)</span>
                <input value={provisionOwnerPassword} onChange={(e) => setProvisionOwnerPassword(e.target.value)} className="h-11 rounded-lg border border-[#483c23] bg-[#221c10] px-3 text-sm text-white" type="text" />
              </label>
            </div>
            <div className="p-5 pt-0 flex justify-end gap-3">
              <button type="button" onClick={() => setProvisionOpen(false)} disabled={provisionSaving} className="h-11 px-4 rounded-lg border border-[#483c23] text-[#c9b792] hover:text-white disabled:opacity-60">
                Cancel
              </button>
              <button type="button" onClick={provision} disabled={provisionSaving} className="h-11 px-5 rounded-lg bg-[#eead2b] text-[#221c11] font-bold hover:bg-[#d69a25] disabled:opacity-60">
                {provisionSaving ? 'Provisioning ¦' : 'Provision'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
