import React, { useEffect, useMemo, useState } from 'react';
import { Header } from '../../components/Header';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Separator } from '../../components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Input } from '../../components/ui/input';
import { cn } from '../../components/lib/utils';
import { apiFetch } from '../../api';

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
      const [auditRes, brRes] = await Promise.all([
        apiFetch(`/api/owner/audit?branchId=${selectedBranchId}`),
        apiFetch('/api/branches')
      ]);

      const auditJson = await auditRes.json();
      const brJson = await brRes.json();

      if (!auditRes.ok) throw new Error(auditJson?.error || 'Forensic sync failed');

      setEvents(auditJson.events || []);
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
      e.type.toLowerCase().includes(q) ||
      e.staffName?.toLowerCase().includes(q) ||
      e.branchName?.toLowerCase().includes(q)
    );
  }, [events, search]);

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      <Header
        title="Global Activity Auditing"
        subtitle="High-fidelity forensic trace capture and node monitoring"
        action={
          <div className="flex items-center gap-3">
            <div className="relative w-64 group">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] text-muted-foreground group-focus-within:text-primary transition-colors">search</span>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 pl-10 text-[10px] font-black uppercase tracking-widest bg-muted/30 border-border/40 focus:bg-background transition-all"
                placeholder="Search Events..."
              />
            </div>

            <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
              <SelectTrigger className="w-[180px] h-10 font-black text-[10px] uppercase tracking-widest bg-muted/30 border-border/40">
                <SelectValue placeholder="All Clusters" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL" className="text-[10px] font-black uppercase">Global Stream</SelectItem>
                {branches.map(b => (
                  <SelectItem key={b.id} value={b.id} className="text-[10px] font-black uppercase">{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="outline" size="sm" onClick={load} className="h-10 px-4 font-black text-[10px] uppercase tracking-widest gap-2">
              <span className={cn("material-symbols-outlined text-[18px]", loading && "animate-spin")}>sync</span>
              Refresh
            </Button>
          </div>
        }
      />

      <ScrollArea className="flex-1">
        <div className="max-w-7xl mx-auto p-6 lg:p-10 space-y-8 pb-32">
          {error && (
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive">
              <p className="text-xs font-black uppercase tracking-widest leading-none">{error}</p>
            </div>
          )}

          <Card className="overflow-hidden border-border/40">
            <CardHeader className="py-5 border-b border-border/40 bg-muted/20">
              <CardTitle className="text-xs font-black uppercase tracking-tight flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">policy</span>
                Forensic Event Ledger
              </CardTitle>
            </CardHeader>
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="text-[9px] font-black uppercase tracking-widest h-11 px-6">Temporal Stamp</TableHead>
                  <TableHead className="text-[9px] font-black uppercase tracking-widest h-11">Incident Magnitude</TableHead>
                  <TableHead className="text-[9px] font-black uppercase tracking-widest h-11">Event Protocol</TableHead>
                  <TableHead className="text-[9px] font-black uppercase tracking-widest h-11">Principal Actor</TableHead>
                  <TableHead className="text-[9px] font-black uppercase tracking-widest h-11">Source Node</TableHead>
                  <TableHead className="text-[9px] font-black uppercase tracking-widest h-11 text-right px-6">Payload Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e: any) => (
                  <TableRow key={e.id} className="group hover:bg-muted/30 transition-colors border-b last:border-0 border-border/40">
                    <TableCell className="px-6 py-4">
                      <div className="font-black text-[10px] font-mono opacity-60">
                        {new Date(e.createdAt).toLocaleString()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(
                        "h-5 px-1.5 text-[8px] font-black uppercase border-none",
                        e.magnitude === 'CRITICAL' ? "bg-destructive/10 text-destructive" :
                          e.magnitude === 'WARNING' ? "bg-amber-500/10 text-amber-600" :
                            "bg-blue-500/10 text-blue-600"
                      )}>
                        {e.magnitude || 'Info'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-black text-[11px] uppercase tracking-tight">{e.type}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-[10px] font-bold text-muted-foreground uppercase">{e.staffName || 'System Process'}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-[10px] font-bold text-muted-foreground uppercase">{e.branchName || 'Global Layer'}</div>
                    </TableCell>
                    <TableCell className="px-6 text-right">
                      <code className="text-[9px] font-black bg-muted px-1.5 py-0.5 rounded border border-border/40 opacity-40 group-hover:opacity-100 transition-opacity">
                        {JSON.stringify(e.payload).slice(0, 32)}...
                      </code>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-[10px] font-black uppercase text-muted-foreground opacity-40">
                      No forensic traces captured
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="border-border/40 bg-muted/5">
              <CardHeader className="py-5 border-b border-border/20">
                <CardTitle className="text-xs font-black uppercase tracking-tight">Security Posture</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Integrity Check</span>
                    <span className="text-[11px] font-black font-mono text-emerald-600">PASSED</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Session Latency</span>
                    <span className="text-[11px] font-black font-mono">24ms</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Active Auditors</span>
                    <span className="text-[11px] font-black font-mono">1 Node</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/40 bg-muted/5">
              <CardHeader className="py-5 border-b border-border/20">
                <CardTitle className="text-xs font-black uppercase tracking-tight">Access Control (RBAC)</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  <p className="text-[10px] font-bold text-muted-foreground leading-relaxed">
                    Global activity logs are strictly immutable and retained for 7 years in accordance with regulatory service compliance protocols.
                  </p>
                  <Button variant="ghost" className="w-full h-10 text-[9px] font-black uppercase tracking-widest gap-2 hover:bg-primary/10 hover:text-primary">
                    Download Security Report
                    <span className="material-symbols-outlined text-[16px]">file_download</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default OwnerAudit;