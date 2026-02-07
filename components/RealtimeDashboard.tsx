import React, { useEffect, useState, useCallback, useRef } from 'react';
import { apiFetch } from '@/api';
import { readSession } from '@/session';
import { formatCurrency } from '@/utils/exportUtils';

import { AppIcon } from '@/components/ui/app-icon';

interface RealtimeMetrics {
  todaySales: number;
  todayOrders: number;
  avgTicket: number;
  activeOrders: number;
  lastUpdated: string;
}

interface RealtimeDashboardProps {
  branchId?: string;
}

export const RealtimeDashboard: React.FC<RealtimeDashboardProps> = ({ branchId }) => {
  const [connected, setConnected] = useState(false);
  const [metrics, setMetrics] = useState<RealtimeMetrics>({
    todaySales: 0,
    todayOrders: 0,
    avgTicket: 0,
    activeOrders: 0,
    lastUpdated: '',
  });
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    const session = readSession<any>();
    if (!session?.token) return;

    const url = new URL('/api/realtime/pos', window.location.origin);
    url.searchParams.set('token', session.token);

    // Add tenant slug for EventSource (can't send custom headers)
    const tenantSlug = session?.tenantSlug || session?.tenant?.slug || '';
    if (tenantSlug) {
      url.searchParams.set('tenant', tenantSlug);
    }

    if (branchId) url.searchParams.set('branchId', branchId);

    const es = new EventSource(url.toString());
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setError(null);
    };

    es.addEventListener('ready', (e) => {
      console.log('[RealtimeDashboard] Connected:', JSON.parse(e.data));
    });

    es.addEventListener('pos', (e) => {
      try {
        const evt = JSON.parse(e.data);
        handleRealtimeEvent(evt);
      } catch (err) {
        console.error('[RealtimeDashboard] Failed to parse event:', err);
      }
    });

    es.addEventListener('ping', () => {
      // Keep-alive, no action needed
    });

    es.onerror = () => {
      setConnected(false);
      es.close();
      
      // Auto-reconnect after 3 seconds
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 3000);
    };

    return () => {
      es.close();
    };
  }, [branchId]);

  const handleRealtimeEvent = (evt: any) => {
    const { type, data } = evt;

    // Map backend event types to frontend types
    const eventType = type === 'pos.order.created' ? 'order:created' :
                     type === 'pos.order.updated' ? 'order:updated' :
                     type === 'pos.order.paid' ? 'order:paid' : type;

    switch (eventType) {
      case 'order:created':
        setMetrics((prev) => ({
          ...prev,
          activeOrders: prev.activeOrders + 1,
          lastUpdated: new Date().toISOString(),
        }));
        break;

      case 'order:updated':
        // When order is paid, update metrics
        if (data?.status === 'Paid' || data?.isPaid) {
          setMetrics((prev) => ({
            ...prev,
            todaySales: prev.todaySales + (data.total || 0),
            todayOrders: prev.todayOrders + 1,
            avgTicket: prev.todayOrders > 0
              ? (prev.todaySales + (data.total || 0)) / (prev.todayOrders + 1)
              : (data.total || 0),
            activeOrders: Math.max(0, prev.activeOrders - 1),
            lastUpdated: new Date().toISOString(),
          }));
          setRecentOrders((prev) => [{
            id: data.orderId,
            orderNumber: data.orderNumber,
            customerName: data.customerName,
            total: data.total,
          }, ...prev.slice(0, 9)]);
        }
        break;

      case 'order:paid':
        setMetrics((prev) => ({
          todaySales: prev.todaySales + (data.total || 0),
          todayOrders: prev.todayOrders + 1,
          avgTicket: prev.todayOrders > 0
            ? (prev.todaySales + (data.total || 0)) / (prev.todayOrders + 1)
            : (data.total || 0),
          activeOrders: Math.max(0, prev.activeOrders - 1),
          lastUpdated: new Date().toISOString(),
        }));
        setRecentOrders((prev) => [{
          id: data.orderId,
          orderNumber: data.orderNumber,
          customerName: data.customerName,
          total: data.total,
        }, ...prev.slice(0, 9)]);
        break;

      case 'metrics:sync':
        if (data) {
          setMetrics({
            todaySales: data.todaySales || 0,
            todayOrders: data.todayOrders || 0,
            avgTicket: data.avgTicket || 0,
            activeOrders: data.activeOrders || 0,
            lastUpdated: new Date().toISOString(),
          });
        }
        break;

      default:
        break;
    }
  };

  // Fetch initial metrics
  const fetchInitialMetrics = useCallback(async () => {
    try {
      const session = readSession<any>();
      if (!session?.token) return;

      const params = new URLSearchParams();
      if (branchId) params.set('branchId', branchId);
      
      const today = new Date().toISOString().split('T')[0];
      params.set('from', today);
      params.set('to', today);

      const res = await apiFetch(`/api/owner/reports/daily?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch metrics');
      
      const data = await res.json();
      if (data.ok && data.daily && data.daily.length > 0) {
        const summary = data.daily[0];
        setMetrics({
          todaySales: summary.netSales || 0,
          todayOrders: summary.orderCount || 0,
          avgTicket: summary.avgTicket || 0,
          activeOrders: 0,
          lastUpdated: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('[RealtimeDashboard] Failed to fetch initial metrics:', err);
    }
  }, [branchId]);

  useEffect(() => {
    fetchInitialMetrics();
    const cleanup = connect();

    return () => {
      if (cleanup) cleanup();
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [connect, fetchInitialMetrics]);

  const getConnectionColor = () => {
    if (connected) return 'text-emerald-500';
    return 'text-amber-500';
  };

  const getConnectionText = () => {
    if (connected) return 'Live';
    return 'Reconnecting...';
  };

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <AppIcon name="dashboard" className="text-primary" size={24} />
          <h3 className="text-lg font-semibold text-foreground">Real-time Dashboard</h3>
        </div>
        <div className={`flex items-center gap-2 text-sm ${getConnectionColor()}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
          {getConnectionText()}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard
          icon="payments"
          label="Today's Sales"
          value={formatCurrency(metrics.todaySales)}
          color="text-emerald-600"
        />
        <MetricCard
          icon="receipt"
          label="Orders"
          value={metrics.todayOrders.toString()}
          color="text-blue-600"
        />
        <MetricCard
          icon="local_offer"
          label="Avg Ticket"
          value={formatCurrency(metrics.avgTicket)}
          color="text-purple-600"
        />
        <MetricCard
          icon="timer"
          label="Active Orders"
          value={metrics.activeOrders.toString()}
          color="text-amber-600"
        />
      </div>

      {/* Recent Orders */}
      {recentOrders.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-3">Recent Orders</h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {recentOrders.map((order, idx) => (
              <div
                key={`${order.id}-${idx}`}
                className="flex items-center justify-between p-3 bg-muted/50 rounded-lg text-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">#{order.orderNumber || order.id?.slice(-6)}</span>
                  <span className="font-medium text-foreground">{order.customerName || 'Guest'}</span>
                </div>
                <span className="font-semibold text-emerald-600">
                  +{formatCurrency(order.total)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Last Updated */}
      {metrics.lastUpdated && (
        <div className="mt-4 text-xs text-muted-foreground text-right">
          Last updated: {new Date(metrics.lastUpdated).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
};

interface MetricCardProps {
  icon: string;
  label: string;
  value: string;
  color: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ icon, label, value, color }) => (
  <div className="bg-muted/50 rounded-lg p-4">
    <div className="flex items-center gap-2 mb-2">
      <AppIcon name={icon} className="text-muted-foreground" size={18} />
      <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
    </div>
    <div className={`text-2xl font-bold ${color}`}>{value}</div>
  </div>
);
