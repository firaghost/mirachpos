/**
 * Shift Context
 *
 * Provides shift state management for the POS application.
 * Tracks current active shift, shift management settings, and provides
 * methods to refresh shift data and check shift status.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../api';

export type ShiftType = 'DAY' | 'NIGHT';

export interface Shift {
  id: string;
  shiftType: ShiftType;
  businessDate: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  openedBy: string;
  openingCash: number;
  orderCount: number;
  netSales: number;
}

interface ShiftContextType {
  // Current shift state
  currentShift: Shift | null;
  isShiftManagementEnabled: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  refreshShift: () => Promise<void>;
  canChangeShift: () => boolean;
  openShift: (shiftType: ShiftType, openingCash: number, notes?: string) => Promise<Shift>;
  closeShift: (shiftId: string, closingCash: number, notes?: string, force?: boolean) => Promise<void>;
  verifyCloseShift: (shiftId: string) => Promise<{
    canClose: boolean;
    expectedCash: number;
    orderCount: number;
    openOrders: Array<{ id: string; status: string; displayNumber: string }>;
    error?: string;
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
  }>;

  // Utility
  formatBusinessDate: (date: string) => string;
  getShiftLabel: (shiftType: ShiftType) => string;
}

const ShiftContext = createContext<ShiftContextType | undefined>(undefined);

export function ShiftProvider({ children }: { children: React.ReactNode }) {
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [isShiftManagementEnabled, setIsShiftManagementEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshShift = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await apiFetch('/api/pos/shifts/current');
      const data = (await res.json().catch(() => null)) as any;

      if (data?.ok) {
        setIsShiftManagementEnabled(data.enabled);
        setCurrentShift(data.shift || null);
      } else {
        setError('Failed to fetch shift data');
      }
    } catch (err) {
      console.error('Error fetching shift:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load and polling
  useEffect(() => {
    refreshShift();

    // Poll for shift changes every 30 seconds
    const interval = setInterval(refreshShift, 30000);

    return () => clearInterval(interval);
  }, [refreshShift]);

  const canChangeShift = useCallback(() => {
    if (!isShiftManagementEnabled) return false;
    if (!currentShift) return true; // Can open if no shift
    return currentShift.status === 'OPEN'; // Can close if shift is open
  }, [isShiftManagementEnabled, currentShift]);

  const openShift = useCallback(async (
    shiftType: ShiftType,
    openingCash: number,
    notes?: string
  ): Promise<Shift> => {
    const res = await apiFetch('/api/pos/shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shiftType, openingCash, notes }),
    });
    const data = (await res.json().catch(() => null)) as any;

    if (!data?.ok) {
      throw new Error(data?.error || 'Failed to open shift');
    }

    const newShift = data.shift;
    setCurrentShift(newShift);
    return newShift;
  }, []);

  const closeShift = useCallback(async (
    shiftId: string,
    closingCash: number,
    notes?: string,
    force?: boolean
  ): Promise<void> => {
    const res = await apiFetch(`/api/pos/shifts/${shiftId}/close`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ closingCash, notes, force }),
    });
    const data = (await res.json().catch(() => null)) as any;

    if (!data?.ok) {
      throw new Error(data?.error || 'Failed to close shift');
    }

    setCurrentShift(null);
  }, []);

  const verifyCloseShift = useCallback(async (shiftId: string) => {
    const res = await apiFetch(`/api/pos/shifts/${shiftId}/verify-close`);
    const data = (await res.json().catch(() => null)) as any;

    if (!data?.ok) {
      throw new Error(data?.error || 'Failed to verify shift close');
    }

    return {
      canClose: data.canClose,
      expectedCash: data.expectedCash,
      orderCount: data.orderCount,
      openOrders: data.openOrders || [],
      error: data.error,
      breakdowns: data.breakdowns,
    };
  }, []);

  const formatBusinessDate = useCallback((date: string): string => {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, []);

  const getShiftLabel = useCallback((shiftType: ShiftType): string => {
    switch (shiftType) {
      case 'DAY':
        return 'Day Shift';
      case 'NIGHT':
        return 'Night Shift';
      default:
        return shiftType;
    }
  }, []);

  const value: ShiftContextType = {
    currentShift,
    isShiftManagementEnabled,
    isLoading,
    error,
    refreshShift,
    canChangeShift,
    openShift,
    closeShift,
    verifyCloseShift,
    formatBusinessDate,
    getShiftLabel,
  };

  return (
    <ShiftContext.Provider value={value}>
      {children}
    </ShiftContext.Provider>
  );
}

export function useShift() {
  const context = useContext(ShiftContext);
  if (context === undefined) {
    throw new Error('useShift must be used within a ShiftProvider');
  }
  return context;
}

export function useShiftStatus() {
  const { currentShift, isShiftManagementEnabled, isLoading } = useShift();

  return {
    hasActiveShift: !!currentShift,
    shiftType: currentShift?.shiftType || null,
    businessDate: currentShift?.businessDate || null,
    isShiftManagementEnabled,
    isLoading,
  };
}
