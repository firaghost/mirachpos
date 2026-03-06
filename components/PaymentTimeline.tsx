import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { apiFetch } from '../api';

interface PaymentEvent {
  id: string;
  eventType: string;
  operation: string;
  fromState: string | null;
  toState: string | null;
  amount: number | null;
  currency: string | null;
  paymentMethod: string | null;
  gateway: string | null;
  providerPaymentId: string | null;
  providerEventId: string | null;
  actorType: string | null;
  actorId: string | null;
  payload: Record<string, any> | null;
  createdAt: string;
}

interface TimelineItemProps {
  event: PaymentEvent;
  isLast: boolean;
}

const stateColors: Record<string, string> = {
  initialized: '#9CA3AF',
  pending_authorization: '#F59E0B',
  authorized: '#3B82F6',
  capture_pending: '#8B5CF6',
  captured: '#10B981',
  failed: '#EF4444',
  voided: '#6B7280',
  refunded_partial: '#F97316',
  refunded_full: '#EF4444',
};

const stateLabels = {
  initialized: 'Initialized',
  pending_authorization: 'Pending Authorization',
  authorized: 'Authorized',
  capture_pending: 'Capture Pending',
  captured: 'Captured',
  failed: 'Failed',
  voided: 'Voided',
  refunded_partial: 'Partially Refunded',
  refunded_full: 'Fully Refunded',
};

const eventTypeLabels = {
  'payment.initialized': 'Payment Initialized',
  'payment.gateway.initiated': 'Gateway Initiated',
  'payment.authorize.requested': 'Authorization Requested',
  'payment.authorize.succeeded': 'Authorization Succeeded',
  'payment.authorize.failed': 'Authorization Failed',
  'payment.capture.requested': 'Capture Requested',
  'payment.capture.succeeded': 'Capture Succeeded',
  'payment.capture.failed': 'Capture Failed',
  'payment.refund.requested': 'Refund Requested',
  'payment.refund.succeeded': 'Refund Succeeded',
  'payment.refund.failed': 'Refund Failed',
  'payment.voided': 'Payment Voided',
  'webhook.received': 'Webhook Received',
  'webhook.duplicate_ignored': 'Duplicate Webhook Ignored',
};

const formatCurrency = (amount, currency = 'ETB') => {
  if (amount == null) return '-';
  return `${Number(amount).toFixed(2)} ${currency}`;
};

const formatDate = (isoString) => {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const TimelineItem: React.FC<TimelineItemProps> = ({ event, isLast }) => {
  const color = stateColors[String(event.toState || '')] || '#6B7280';
  const eventLabel = eventTypeLabels[String(event.eventType || '')] || event.eventType;
  const stateLabel = stateLabels[String(event.toState || '')] || event.toState;

  const payloadPreview = useMemo(() => {
    if (!event.payload || typeof event.payload !== 'object') return [];
    return Object.entries(event.payload).slice(0, 3);
  }, [event.payload]);

  return (
    <div className="flex gap-3">
      <div className="w-5 flex flex-col items-center">
        <div className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
        {!isLast ? <div className="flex-1 w-px bg-border mt-1" /> : null}
      </div>

      <div className="flex-1 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-bold text-foreground">{eventLabel}</div>
          <div className="text-[11px] text-muted-foreground whitespace-nowrap">{formatDate(event.createdAt)}</div>
        </div>

        {event.toState ? (
          <div className="mt-1 inline-flex items-center gap-2">
            <span
              className="px-2 py-0.5 rounded text-[11px] font-black border"
              style={{ color, borderColor: color + '55', backgroundColor: color + '18' }}
            >
              {stateLabel}
            </span>
          </div>
        ) : null}

        {event.amount != null ? (
          <div className="mt-1 text-sm font-extrabold text-foreground">{formatCurrency(event.amount, event.currency || 'ETB')}</div>
        ) : null}

        <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
          {event.paymentMethod ? <div>Method: <span className="text-foreground font-semibold">{event.paymentMethod}</span></div> : null}
          {event.gateway ? <div>Gateway: <span className="text-foreground font-semibold">{event.gateway}</span></div> : null}
          {event.providerPaymentId ? <div>Provider ID: <span className="text-foreground font-mono">{event.providerPaymentId}</span></div> : null}
          {event.actorType ? (
            <div>
              Actor: <span className="text-foreground font-semibold">{event.actorType}</span>
              {event.actorId ? <span className="text-muted-foreground"> ({String(event.actorId).slice(0, 8)}…)</span> : null}
            </div>
          ) : null}
        </div>

        {payloadPreview.length ? (
          <div className="mt-2 rounded-lg border border-border bg-card/60 p-2">
            <div className="text-[11px] font-black text-muted-foreground uppercase tracking-wider">Details</div>
            <div className="mt-1 text-[11px] text-muted-foreground space-y-0.5">
              {payloadPreview.map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <div className="min-w-[92px] text-muted-foreground/80">{k}</div>
                  <div className="text-foreground font-medium break-all">
                    {typeof v === 'string' ? v : JSON.stringify(v).slice(0, 80)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

type Props = {
  orderId: string;
  refreshInterval?: number;
  defaultCollapsed?: boolean;
};

const PaymentTimeline: React.FC<Props> = ({ orderId, refreshInterval = 30000, defaultCollapsed = true }) => {
  const [events, setEvents] = useState<PaymentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [lastRefresh, setLastRefresh] = useState<string>('');
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const fetchTimeline = useCallback(async () => {
    if (!orderId) return;
    try {
      const res = await apiFetch(`/api/pos/orders/${orderId}/payment-timeline`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.events)) {
        setEvents(data.events as PaymentEvent[]);
        setError('');
      } else {
        setError(String(data.error || 'Failed to load timeline'));
      }
    } catch (e) {
      setError('Network error');
    } finally {
      setLoading(false);
      setLastRefresh(new Date().toISOString());
    }
  }, [orderId]);

  useEffect(() => {
    fetchTimeline();
    if (refreshInterval > 0) {
      const id = setInterval(fetchTimeline, refreshInterval);
      return () => clearInterval(id);
    }
  }, [fetchTimeline, refreshInterval]);

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-secondary/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="text-sm font-extrabold text-foreground">Payment Timeline</div>
          {events.length ? (
            <div className="text-[11px] font-black px-2 py-0.5 rounded bg-secondary text-muted-foreground">{events.length}</div>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">{collapsed ? 'Show' : 'Hide'}</div>
      </button>

      {!collapsed ? (
        <div className="px-4 pb-4">
          <div className="flex items-center justify-between pt-2">
            <div className="text-[11px] text-muted-foreground">
              {lastRefresh ? `Last updated: ${formatDate(lastRefresh)}` : ''}
            </div>
            <button
              type="button"
              onClick={() => void fetchTimeline()}
              className="h-8 px-3 rounded-lg border border-border bg-background hover:bg-secondary text-foreground text-xs font-bold"
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : error ? (
            <div className="py-6 text-center">
              <div className="text-sm text-destructive font-bold">{error}</div>
              <button
                type="button"
                onClick={() => void fetchTimeline()}
                className="mt-3 h-9 px-4 rounded-lg bg-primary text-primary-foreground font-extrabold"
              >
                Retry
              </button>
            </div>
          ) : events.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No payment events yet</div>
          ) : (
            <div className="mt-3 space-y-0">
              {events.map((event, index) => (
                <TimelineItem key={event.id || String(index)} event={event} isLast={index === events.length - 1} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default PaymentTimeline;
