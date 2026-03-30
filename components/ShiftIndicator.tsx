/**
 * ShiftIndicator Component
 *
 * Displays current shift information in the header.
 * Shows shift type (DAY/NIGHT), business date, and quick actions.
 */

import React from 'react';
import { useShift, ShiftType } from '../src/contexts/ShiftContext';
import { Button } from './ui/button';
import { Sun, Moon, AlertCircle } from 'lucide-react';

interface ShiftIndicatorProps {
  onOpenShiftModal?: () => void;
  compact?: boolean;
}

export const ShiftIndicator: React.FC<ShiftIndicatorProps> = ({
  onOpenShiftModal,
  compact = false,
}) => {
  const {
    currentShift,
    isShiftManagementEnabled,
    isLoading,
    formatBusinessDate,
    getShiftLabel,
  } = useShift();

  // Don't show if shift management is not enabled
  if (!isShiftManagementEnabled) {
    return null;
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-md">
        <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        {!compact && <span className="text-sm text-muted-foreground">Loading...</span>}
      </div>
    );
  }

  // No active shift
  if (!currentShift) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={onOpenShiftModal}
        className="gap-2 border-amber-500/50 text-amber-600 hover:bg-amber-50"
      >
        <AlertCircle className="w-4 h-4" />
        {!compact && <span>No Active Shift</span>}
      </Button>
    );
  }

  const shiftColor = currentShift.shiftType === 'DAY'
    ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200'
    : 'bg-indigo-100 text-indigo-800 border-indigo-300 hover:bg-indigo-200';

  const ShiftIcon = currentShift.shiftType === 'DAY' ? Sun : Moon;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onOpenShiftModal}
      className={`gap-2 ${shiftColor} border`}
    >
      <ShiftIcon className="w-4 h-4" />
      {!compact && (
        <>
          <span className="font-medium">{getShiftLabel(currentShift.shiftType)}</span>
          <span className="text-xs opacity-75">
            {formatBusinessDate(currentShift.businessDate)}
          </span>
        </>
      )}
    </Button>
  );
};

export default ShiftIndicator;
