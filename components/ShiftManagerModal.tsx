/**
 * ShiftManagerModal Component
 *
 * Modal for managing shifts - opening new shifts and closing current shifts.
 * Provides cash reconciliation and shift reporting.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useShift, ShiftType } from '../src/contexts/ShiftContext';
import { Button } from './ui/button';
import { Modal } from './ui/modal';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Sun, Moon, AlertCircle, TrendingUp, DollarSign, ShoppingCart, RefreshCw, Wifi, WifiOff } from 'lucide-react';

interface ShiftManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ShiftManagerModal: React.FC<ShiftManagerModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    currentShift,
    isShiftManagementEnabled,
    isLoading,
    openShift,
    closeShift,
    verifyCloseShift,
    getShiftLabel,
    formatBusinessDate,
    refreshShift,
  } = useShift();

  const [activeTab, setActiveTab] = useState<'current' | 'close' | 'new'>('current');
  const [shiftType, setShiftType] = useState<ShiftType>('DAY');
  const [openingCash, setOpeningCash] = useState<string>('');
  const [closingCash, setClosingCash] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [closePreview, setClosePreview] = useState<{
    canClose: boolean;
    expectedCash: number;
    orderCount: number;
    openOrders: Array<{ id: string; status: string; displayNumber: string }>;
    breakdowns?: {
      summary: {
        totalOrders: number;
        paidOrders: number;
        voidedOrders: number;
        refundedOrders: number;
        totalSales: number;
        totalTax: number;
        totalTips: number;
        totalDiscounts: number;
        netSales: number;
      };
      paymentBreakdown: Record<string, number>;
      openingCash: number;
      cashReceived: number;
      expectedCash: number;
    };
  } | null>(null);

  // Network status monitoring - stable, doesn't re-register on every render
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []); // Only run once on mount

  // Refresh when coming back online - separate from event listener registration
  useEffect(() => {
    if (isOnline && isOpen) {
      refreshShift();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]); // Only run when online status changes

  // Auto-refresh data every 30 seconds when modal is open
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      if (navigator.onLine) {
        refreshShift();
        setLastRefresh(new Date());
      }
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]); // Intentionally omit refreshShift to prevent infinite loop

  // Load close preview function - NOT memoized to prevent recreation issues
  const loadClosePreview = async () => {
    if (!currentShift || isRefreshing) return;
    setIsRefreshing(true);
    setError(null);
    try {
      const data = await verifyCloseShift(currentShift.id);
      setClosePreview(prev => {
        // Only update if data actually changed
        if (JSON.stringify(prev) === JSON.stringify(data)) return prev;
        return data;
      });
      setLastRefresh(new Date());
    } catch (err) {
      console.error('[ShiftManager] Failed to load close preview:', err);
      setError('Failed to load close preview: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsRefreshing(false);
    }
  };

  // Manual refresh handler
  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await refreshShift();
    if (activeTab === 'close' && currentShift) {
      await loadClosePreview();
    }
    setLastRefresh(new Date());
    setIsRefreshing(false);
  };

  // Reset state when modal opens - ONLY when isOpen changes, not on every render
  useEffect(() => {
    if (isOpen) {
      setActiveTab(currentShift ? 'current' : 'new');
      setShiftType(currentShift?.shiftType === 'DAY' ? 'NIGHT' : 'DAY');
      setOpeningCash('');
      setClosingCash('');
      setNotes('');
      setError(null);
      setClosePreview(null);
      setLastRefresh(new Date());
      // Initial data load - only once when modal opens
      refreshShift();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]); // Intentionally omit currentShift and refreshShift

  // Load close preview when switching to close tab - memoized
  useEffect(() => {
    if (activeTab === 'close' && currentShift?.id) {
      loadClosePreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentShift?.id]); // Only re-run when tab or shift ID changes

  const handleOpenShift = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const cash = parseFloat(openingCash) || 0;
      await openShift(shiftType, cash, notes);
      await refreshShift();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open shift');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseShift = async () => {
    if (!currentShift) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const cash = parseFloat(closingCash) || 0;
      await closeShift(currentShift.id, cash, notes);
      await refreshShift();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close shift');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isShiftManagementEnabled) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Shift Management">
        <div className="p-6 text-center">
          <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">
            Shift management is not enabled for this branch.
            Please contact the owner or manager to enable it in branch settings.
          </p>
          <Button onClick={onClose} className="mt-4">
            Close
          </Button>
        </div>
      </Modal>
    );
  }

  const formatLastRefresh = () => {
    const now = new Date();
    const diff = now.getTime() - lastRefresh.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  };

  const formatTimeAgo = (date: string) => {
    const now = new Date();
    const then = new Date(date);
    const diff = now.getTime() - then.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return then.toLocaleDateString();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Shift Management">
      <div className="p-2">
        {/* Network Status & Refresh Bar */}
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            {isOnline ? (
              <Wifi className="w-4 h-4 text-green-500" />
            ) : (
              <WifiOff className="w-4 h-4 text-red-500" />
            )}
            <span className={`text-xs ${isOnline ? 'text-green-600' : 'text-red-600'}`}>
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Updated {formatLastRefresh()}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleManualRefresh}
              disabled={isRefreshing || !isOnline}
              className="h-6 w-6 p-0"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
        {/* Tab Navigation */}
        <div className="flex gap-1 mb-3">
          {currentShift && (
            <>
              <Button
                variant={activeTab === 'current' ? 'default' : 'outline'}
                onClick={() => setActiveTab('current')}
                className="flex-1"
              >
                Current Shift
              </Button>
              <Button
                variant={activeTab === 'close' ? 'default' : 'outline'}
                onClick={() => setActiveTab('close')}
                className="flex-1"
              >
                Close Shift
              </Button>
            </>
          )}
          <Button
            variant={activeTab === 'new' ? 'default' : 'outline'}
            onClick={() => setActiveTab('new')}
            className="flex-1"
          >
            Open New Shift
          </Button>
        </div>

        {/* Current Shift View */}
        {activeTab === 'current' && currentShift && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <div className={`p-2 rounded-full ${
                currentShift.shiftType === 'DAY' ? 'bg-amber-100' : 'bg-indigo-100'
              }`}>
                {currentShift.shiftType === 'DAY' ? (
                  <Sun className="w-5 h-5 text-amber-600" />
                ) : (
                  <Moon className="w-5 h-5 text-indigo-600" />
                )}
              </div>
              <div>
                <h3 className="font-semibold">
                  {getShiftLabel(currentShift.shiftType)}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Business Date: {formatBusinessDate(currentShift.businessDate)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 border rounded-lg">
                <div className="flex items-center gap-1 text-muted-foreground mb-1">
                  <ShoppingCart className="w-3 h-3" />
                  <span className="text-xs">Orders</span>
                </div>
                <p className="text-lg font-bold">{currentShift.orderCount}</p>
              </div>
              <div className="p-2 border rounded-lg">
                <div className="flex items-center gap-1 text-muted-foreground mb-1">
                  <TrendingUp className="w-3 h-3" />
                  <span className="text-xs">Net Sales</span>
                </div>
                <p className="text-lg font-bold">
                  ETB {(currentShift.netSales ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="p-2 border rounded-lg">
                <div className="flex items-center gap-1 text-muted-foreground mb-1">
                  <DollarSign className="w-3 h-3" />
                  <span className="text-xs">Opening Cash</span>
                </div>
                <p className="text-lg font-bold">
                  ETB {(currentShift.openingCash ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            <div className="p-2 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">
                Opened {formatTimeAgo(currentShift.openedAt)} • {new Date(currentShift.openedAt).toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {/* Close Shift View */}
        {activeTab === 'close' && currentShift && (
          <div className="space-y-3">
            {!closePreview && !error && (
              <div className="p-4 text-center">
                <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Loading shift data...</p>
              </div>
            )}
            
            {error && (
              <div className="p-2 bg-red-50 text-red-600 rounded-md text-xs">
                {error}
              </div>
            )}
            
            {closePreview && (
              <>
                {!closePreview.canClose && closePreview.openOrders.length > 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-center gap-2 text-amber-700 mb-1">
                      <AlertCircle className="w-4 h-4" />
                      <span className="font-medium text-sm">Open Orders Detected</span>
                    </div>
                    <ul className="text-xs text-amber-600 space-y-1">
                      {closePreview.openOrders.map((order) => (
                        <li key={order.id}>
                          Order #{order.displayNumber} - {order.status}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Shift Breakdowns */}
                {closePreview.breakdowns && (
                  <div className="space-y-2">
                    {/* Sales Summary */}
                    <div className="p-3 bg-muted rounded-lg">
                      <h4 className="font-semibold text-sm mb-2">Sales Summary</h4>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Total Orders</span>
                          <span className="font-medium">{closePreview.breakdowns.summary.totalOrders}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Paid Orders</span>
                          <span className="font-medium text-green-600">{closePreview.breakdowns.summary.paidOrders}</span>
                        </div>
                        <div className="flex justify-between border-t pt-1 mt-1 col-span-2">
                          <span className="font-semibold">Net Sales</span>
                          <span className="font-bold">ETB {(closePreview.breakdowns.summary.netSales ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    </div>

                    {/* Cash Summary */}
                    <div className="p-3 bg-muted rounded-lg">
                      <h4 className="font-semibold text-sm mb-2">Cash Summary</h4>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Opening Cash</span>
                          <span className="font-medium">ETB {(closePreview.breakdowns.openingCash ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Cash Received</span>
                          <span className="font-medium text-green-600">+ETB {(closePreview.breakdowns.cashReceived ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between border-t pt-1">
                          <span className="font-semibold">Expected Cash</span>
                          <span className="font-bold">ETB {(closePreview.breakdowns.expectedCash ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="closingCash" className="text-sm">Actual Cash Counted</Label>
                  <Input
                    id="closingCash"
                    type="number"
                    value={closingCash}
                    onChange={(e) => setClosingCash(e.target.value)}
                    placeholder="Enter actual cash amount"
                    className="h-9"
                  />
                  {closingCash && (
                    <p className="text-xs">
                      Difference:{' '}
                      <span className={
                        (parseFloat(closingCash) - closePreview.expectedCash) === 0
                          ? 'text-green-600'
                          : 'text-amber-600'
                      }>
                        ETB {(parseFloat(closingCash) - closePreview.expectedCash).toFixed(2)}
                      </span>
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes" className="text-sm">Closing Notes (Optional)</Label>
                  <textarea
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any notes about this shift..."
                    className="w-full min-h-[60px] px-3 py-2 border rounded-md text-sm"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setActiveTab('current')}
                    className="flex-1 h-9"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCloseShift}
                    disabled={isSubmitting || (!closePreview.canClose && closingCash === '')}
                    className="flex-1 h-9 bg-red-600 hover:bg-red-700"
                  >
                    {isSubmitting ? 'Closing...' : 'Close Shift'}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* New Shift View */}
        {activeTab === 'new' && (
          <div className="space-y-3">
            {currentShift && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-center gap-2 text-amber-700">
                  <AlertCircle className="w-4 h-4" />
                  <span className="font-medium text-sm">
                    Current {getShiftLabel(currentShift.shiftType)} must be closed first
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-sm">Shift Type</Label>
              <Select
                value={shiftType}
                onValueChange={(v) => setShiftType(v as ShiftType)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAY">
                    <div className="flex items-center gap-2">
                      <Sun className="w-4 h-4 text-amber-500" />
                      Day Shift
                    </div>
                  </SelectItem>
                  <SelectItem value="NIGHT">
                    <div className="flex items-center gap-2">
                      <Moon className="w-4 h-4 text-indigo-500" />
                      Night Shift
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="openingCash" className="text-sm">Opening Cash Amount</Label>
              <Input
                id="openingCash"
                type="number"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                placeholder="Enter opening cash amount"
                className="h-9"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="notes" className="text-sm">Notes (Optional)</Label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes about this shift..."
                className="w-full min-h-[60px] px-3 py-2 border rounded-md text-sm"
              />
            </div>

            {error && (
              <div className="p-2 bg-red-50 text-red-600 rounded-md text-xs">
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 h-9"
              >
                Cancel
              </Button>
              <Button
                onClick={handleOpenShift}
                disabled={isSubmitting || !openingCash}
                className="flex-1 h-9"
                style={{ backgroundColor: 'var(--mirach-primary)' }}
              >
                {isSubmitting ? 'Opening...' : 'Open Shift'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ShiftManagerModal;
