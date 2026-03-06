import React, { useEffect, useMemo, useState } from 'react';

import { AppIcon } from '@/components/ui/app-icon';

type TicketItem = {
  id: string;
  name: string;
  qty: number;
  voided_qty: number;
  notes?: string | null;
  prep_state: string;
};

type Ticket = {
  id: string;
  order_id: string;
  station: string;
  course_no: number;
  status: string;
  priority: number;
  created_at: string;
  fired_at?: string | null;
  ready_at?: string | null;
  bumped_at?: string | null;
  sla_due_at?: string | null;
  meta?: { tableName?: string | null; number?: string | null };
  items: TicketItem[];
};

type Props = {
  open: boolean;
  ticket: Ticket | null;
  onClose: () => void;
  onReady: (ticketId: string) => void;
  onBump: (ticketId: string) => void;
  onRecall: (ticketId: string) => void;
  onPrintKitchen?: (orderId: string) => void;
  printing?: boolean;
  variant?: 'overlay' | 'inline';
};

const minsSince = (iso: string | null | undefined, nowMs: number) => {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const d = nowMs - ms;
  if (!Number.isFinite(d) || d < 0) return null;
  return Math.max(0, Math.floor(d / 60000));
};

const slaRemainingMins = (dueAtIso: string | null | undefined, nowMs: number) => {
  if (!dueAtIso) return null;
  const dueMs = new Date(dueAtIso).getTime();
  if (!Number.isFinite(dueMs)) return null;
  return Math.round((dueMs - nowMs) / 60000);
};

export const TicketDetailDrawer: React.FC<Props> = ({
  open,
  ticket,
  onClose,
  onReady,
  onBump,
  onRecall,
  onPrintKitchen,
  printing,
  variant = 'overlay',
}) => {
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [open]);

  const t = ticket;

  const canPrint = Boolean(onPrintKitchen);
  const isPrinting = Boolean(printing);

  const status = String(t?.status || '').trim().toUpperCase();
  const table = t?.meta?.tableName ? String(t.meta.tableName) : 'Table';
  const num = t?.meta?.number ? String(t.meta.number) : '';

  const ageMin = minsSince(t?.fired_at || t?.created_at, nowTick);
  const rem = slaRemainingMins(t?.sla_due_at, nowTick);
  const slaText = rem == null ? '-' : rem >= 0 ? `Due in ${rem}m` : `Overdue ${Math.abs(rem)}m`;

  const primary = useMemo(() => {
    if (!t) return null;
    if (status === 'NEW' || status === 'FIRED' || status === 'IN_PREP' || status === 'RECALLED') {
      return { key: 'ready', label: 'Ready', onClick: () => onReady(t.id) } as const;
    }
    if (status === 'READY') {
      return { key: 'bump', label: 'Bump', onClick: () => onBump(t.id) } as const;
    }
    if (status === 'BUMPED') {
      return { key: 'recall', label: 'Recall', onClick: () => onRecall(t.id) } as const;
    }
    return { key: 'ready', label: 'Ready', onClick: () => onReady(t.id) } as const;
  }, [onBump, onReady, onRecall, status, t]);

  if (!open) return null;

  const content = (
    <>
      <div className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-border">
        <div className="px-5 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-black uppercase tracking-widest text-muted-foreground">Ticket</div>
            <div className="text-2xl font-black text-foreground truncate">
              {table}
              {num ? ` ${num}` : ''}
            </div>
            <div className="mt-1 text-xs text-muted-foreground font-semibold uppercase tracking-widest">
              {t?.station ? String(t.station) : '-'}
              <span className="text-muted-foreground/50">  </span>
              C{t?.course_no ?? '-'}
              <span className="text-muted-foreground/50">  </span>
              {status || '-'}
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg bg-accent hover:bg-accent/80 border border-border flex items-center justify-center transition-colors"
            title="Close"
          >
            <AppIcon name="close" />
          </button>
        </div>

        {t ? (
          <div className="px-5 pb-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-border bg-background p-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Age</div>
                <div className="mt-1 text-sm font-extrabold">{ageMin != null ? `${ageMin}m` : '-'}</div>
              </div>
              <div className="rounded-xl border border-border bg-background p-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">SLA</div>
                <div className={`mt-1 text-sm font-extrabold ${rem != null && rem < 0 ? 'text-red-600' : ''}`}>{slaText}</div>
              </div>
              <div className="rounded-xl border border-border bg-background p-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Items</div>
                <div className="mt-1 text-sm font-extrabold">{Array.isArray(t.items) ? t.items.length : 0}</div>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              {primary ? (
                <button
                  disabled={!t}
                  onClick={() => primary.onClick()}
                  className="h-11 px-4 rounded-xl bg-primary text-primary-foreground font-black uppercase tracking-widest border border-primary/20 disabled:opacity-50"
                >
                  {primary.label}
                </button>
              ) : null}

              {status !== 'BUMPED' ? (
                <button
                  disabled={!t}
                  onClick={() => (t ? onBump(t.id) : null)}
                  className="h-11 px-4 rounded-xl bg-secondary text-foreground font-black uppercase tracking-widest border border-border disabled:opacity-50"
                >
                  Bump
                </button>
              ) : null}

              <button
                disabled={!t}
                onClick={() => (t ? onRecall(t.id) : null)}
                className="h-11 px-4 rounded-xl bg-background text-foreground font-black uppercase tracking-widest border border-border disabled:opacity-50"
              >
                Recall
              </button>

              {canPrint ? (
                <button
                  disabled={!t || isPrinting}
                  onClick={() => (t ? onPrintKitchen?.(t.order_id) : null)}
                  className="h-11 px-4 rounded-xl bg-background border border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40 font-black uppercase tracking-widest disabled:opacity-50"
                  title="Print to kitchen printer"
                >
                  {isPrinting ? 'Printing…' : 'Print'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {!t ? (
          <div className="text-sm text-muted-foreground">No ticket selected.</div>
        ) : (
          <>
            <div className="mt-5">
              <div className="text-xs font-black uppercase tracking-widest text-muted-foreground">Items</div>
              <div className="mt-3 space-y-3">
                {t.items.map((it) => {
                  const effective = Math.max(0, Number(it.qty || 0) - Number(it.voided_qty || 0));
                  return (
                    <div key={it.id} className="rounded-xl border border-border bg-background p-3">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-secondary border border-border flex items-center justify-center font-black text-base">
                          {effective}
                        </div>
                        <div className="flex-1">
                          <div className="font-black text-foreground text-base leading-snug">{it.name}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground font-semibold uppercase tracking-widest">{String(it.prep_state || '')}</div>
                          {it.notes ? <div className="mt-2 text-sm font-semibold text-foreground/90 bg-secondary border border-border rounded-xl px-3 py-2">{String(it.notes)}</div> : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );

  if (variant === 'inline') {
    return (
      <aside className="h-full w-full bg-card border-l border-border shadow-[0_0_0_1px_rgba(0,0,0,0.02)] flex flex-col">
        {content}
      </aside>
    );
  }

  return (
    <div className="fixed inset-0 z-[120]">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <aside className="absolute top-0 right-0 h-full w-full max-w-xl bg-card border-l border-border shadow-2xl flex flex-col">
        {content}
      </aside>
    </div>
  );
};
