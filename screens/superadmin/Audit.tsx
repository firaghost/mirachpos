import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../api';
import { Header } from '../../components/Header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Modal } from '../../components/ui/modal';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { cn } from '../../components/lib/utils';
import { formatDeviceDateTime } from '../../datetime';

type AuditRow = {
  id: string;
  branchId: string;
  actorStaffId: string;
  actorName: string;
  actorEmail: string;
  actorRole: string;
  type: string;
  summary: string;
  payload: any;
  at: string;
};

const fmtTime = (iso: string) => {
  return formatDeviceDateTime(iso) || '';
};

const downloadText = (filename: string, content: string, mime = 'text/plain;charset=utf-8') => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const toCsvCell = (v: unknown) => {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

export const SA_Audit: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [rows, setRows] = useState<AuditRow[]>([]);

  const [q, setQ] = useState('');
  const [branchId, setBranchId] = useState('');
  const [includeSystem, setIncludeSystem] = useState(true);
  const [limit, setLimit] = useState(100);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('limit', String(Math.max(1, Math.min(200, Number(limit) || 100))));
      if (branchId.trim()) params.set('branchId', branchId.trim());
      if (includeSystem) params.set('includeSystem', '1');

      const res = await apiFetch(`/api/audit/list?${params.toString()}`);
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const list = Array.isArray(json?.audit) ? (json.audit as AuditRow[]) : [];
      setRows(list);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [branchId, includeSystem, limit]);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter((r) => {
      const payloadStr = (() => {
        try {
          return r.payload ? JSON.stringify(r.payload) : '';
        } catch {
          return '';
        }
      })();
      return (
        r.id.toLowerCase().includes(needle) ||
        r.type.toLowerCase().includes(needle) ||
        r.summary.toLowerCase().includes(needle) ||
        r.actorName.toLowerCase().includes(needle) ||
        r.actorEmail.toLowerCase().includes(needle) ||
        r.actorRole.toLowerCase().includes(needle) ||
        r.branchId.toLowerCase().includes(needle) ||
        payloadStr.toLowerCase().includes(needle)
      );
    });
  }, [q, rows]);

  const exportJson = () => {
    downloadText(`audit-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(filtered, null, 2), 'application/json;charset=utf-8');
  };

  const exportCsv = () => {
    const header = ['at', 'type', 'summary', 'actorRole', 'actorName', 'actorEmail', 'branchId', 'id'];
    const lines = [
      header.join(','),
      ...filtered.map((r) =>
        header
          .map((k) => toCsvCell((r as any)[k]))
          .join(',')
      ),
    ].join('\n');
    downloadText(`audit-${new Date().toISOString().slice(0, 10)}.csv`, lines, 'text/csv;charset=utf-8');
  };

  const typeBadge = (type: string) => {
    const t = String(type || '').toLowerCase();
    if (t.includes('delete') || t.includes('void') || t.includes('reject')) return 'bg-destructive/10 text-destructive border-destructive/20';
    if (t.includes('create') || t.includes('provision') || t.includes('approve')) return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    if (t.includes('login') || t.includes('auth')) return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
    return 'bg-muted text-muted-foreground border-border';
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      <Header
        title="Audit Log"
        subtitle="Security & compliance events"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0} className="h-9 text-[10px] font-black uppercase tracking-widest">
              Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportJson} disabled={filtered.length === 0} className="h-9 text-[10px] font-black uppercase tracking-widest">
              Export JSON
            </Button>
            <Button size="sm" onClick={fetchAudit} disabled={loading} className="h-9 text-[10px] font-black uppercase tracking-widest gap-2">
              <span className={cn('material-symbols-outlined text-[18px]', loading && 'animate-spin')}>refresh</span>
              Refresh
            </Button>
          </div>
        }
      />

      <div className="border-b bg-card/40 p-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-5">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Search</div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search type, actor, summary, branch, payload..." className="h-10" />
          </div>

          <div className="lg:col-span-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Branch ID</div>
            <Input value={branchId} onChange={(e) => setBranchId(e.target.value)} placeholder="global or branch uuid" className="h-10 font-mono" />
          </div>

          <div className="lg:col-span-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Limit</div>
            <select
              value={String(limit)}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {[25, 50, 100, 150, 200].map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2 flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground select-none">
              <input type="checkbox" checked={includeSystem} onChange={(e) => setIncludeSystem(e.target.checked)} />
              Include system
            </label>
            <Button variant="outline" size="sm" onClick={fetchAudit} disabled={loading} className="h-10">
              Apply
            </Button>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6">
          {error && (
            <Card className="bg-destructive/10 border-destructive/20 mb-4">
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-destructive">error</span>
                  <div className="text-xs font-bold text-destructive">{error}</div>
                </div>
                <Button variant="outline" size="sm" onClick={fetchAudit} className="h-9">Retry</Button>
              </CardContent>
            </Card>
          )}

          <Card className="border-border/40 overflow-hidden">
            <CardHeader className="py-4 border-b bg-muted/10">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-xs font-black uppercase tracking-widest">Events</CardTitle>
                <div className="text-[10px] font-bold text-muted-foreground font-mono">{filtered.length} rows</div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">Time</TableHead>
                    <TableHead className="w-[180px]">Type</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead className="w-[220px]">Actor</TableHead>
                    <TableHead className="w-[140px]">Branch</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">Loading ¦</TableCell>
                    </TableRow>
                  )}
                  {!loading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">No audit events found.</TableCell>
                    </TableRow>
                  )}
                  {!loading &&
                    filtered.map((r) => (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer"
                        onClick={() => setSelectedId(r.id)}
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground">{fmtTime(r.at)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('text-[10px] font-black uppercase border', typeBadge(r.type))}>
                            {r.type || 'event'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-bold truncate max-w-[700px]">{r.summary || ' ”'}</div>
                          <div className="text-[10px] text-muted-foreground font-mono mt-1">{r.id}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-bold">{r.actorName || r.actorRole || ' ”'}</div>
                          <div className="text-muted-foreground">{r.actorEmail || ''}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.branchId || 'global'}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>

      <Modal
        open={Boolean(selected)}
        title="Audit Event"
        onClose={() => setSelectedId(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setSelectedId(null)}>Close</Button>
          </>
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Type</div>
                <div className="font-mono font-black">{selected.type || 'event'}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Time</div>
                <div className="font-mono font-black">{fmtTime(selected.at)}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Actor</div>
                <div className="font-bold">{selected.actorName || ' ”'}</div>
                <div className="text-muted-foreground">{selected.actorEmail || selected.actorRole || ''}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Branch</div>
                <div className="font-mono font-black">{selected.branchId || 'global'}</div>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Summary</div>
              <div className="text-sm font-bold">{selected.summary || ' ”'}</div>
            </div>

            <div className="space-y-1">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Payload</div>
              <pre className="text-[11px] bg-muted/30 border rounded-lg p-3 overflow-auto max-h-[45vh]">
                {(() => {
                  try {
                    return selected.payload == null ? 'null' : JSON.stringify(selected.payload, null, 2);
                  } catch {
                    return String(selected.payload ?? '');
                  }
                })()}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default SA_Audit;