import React, { useState, useMemo } from 'react';
import { formatCurrency } from '../utils/exportUtils';
import { AppIcon } from '@/components/ui/app-icon';

interface ComparisonData {
  label: string;
  current: number;
  previous: number;
}

interface PeriodComparisonProps {
  title: string;
  currentPeriod: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  data: {
    sales: ComparisonData;
    orders: ComparisonData;
    avgTicket: ComparisonData;
    items: ComparisonData;
  };
}

export const PeriodComparison: React.FC<PeriodComparisonProps> = ({
  title,
  currentPeriod,
  previousPeriod,
  data,
}) => {
  const [expanded, setExpanded] = useState(false);

  const calculateChange = (current: number, previous: number): { value: number; positive: boolean } => {
    if (previous === 0) return { value: current > 0 ? 100 : 0, positive: current >= 0 };
    const change = ((current - previous) / previous) * 100;
    return { value: Math.abs(change), positive: change >= 0 };
  };

  const metrics = useMemo(() => [
    {
      key: 'sales',
      label: 'Net Sales',
      icon: 'payments',
      data: data.sales,
      format: formatCurrency,
    },
    {
      key: 'orders',
      label: 'Orders',
      icon: 'receipt',
      data: data.orders,
      format: (v: number) => v.toLocaleString(),
    },
    {
      key: 'avgTicket',
      label: 'Avg Ticket',
      icon: 'local_offer',
      data: data.avgTicket,
      format: formatCurrency,
    },
    {
      key: 'items',
      label: 'Items Sold',
      icon: 'shopping_basket',
      data: data.items,
      format: (v: number) => v.toLocaleString(),
    },
  ], [data]);

  const formatDateRange = (from: string, to: string) => {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const sameMonth = fromDate.getMonth() === toDate.getMonth() && fromDate.getFullYear() === toDate.getFullYear();
    
    if (sameMonth) {
      return `${fromDate.getDate()}-${toDate.getDate()} ${fromDate.toLocaleString('default', { month: 'short' })}`;
    }
    return `${fromDate.toLocaleDateString()} - ${toDate.toLocaleDateString()}`;
  };

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <AppIcon name="compare_arrows" className="text-primary" size={24} />
          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground">
              Comparing {formatDateRange(currentPeriod.from, currentPeriod.to)} vs {formatDateRange(previousPeriod.from, previousPeriod.to)}
            </p>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-2 hover:bg-muted rounded-lg transition-colors"
        >
          <AppIcon 
            name={expanded ? 'expand_less' : 'expand_more'} 
            className="text-muted-foreground"
            size={20}
          />
        </button>
      </div>

      {/* Comparison Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((metric) => {
          const change = calculateChange(metric.data.current, metric.data.previous);
          const isPositiveGood = metric.key !== 'voids'; // Voids are bad when increasing
          const isGoodChange = isPositiveGood ? change.positive : !change.positive;

          return (
            <div key={metric.key} className="bg-muted/50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <AppIcon name={metric.icon} className="text-muted-foreground" size={16} />
                <span className="text-xs text-muted-foreground uppercase tracking-wide">
                  {metric.label}
                </span>
              </div>
              
              <div className="text-xl font-bold text-foreground mb-1">
                {metric.format(metric.data.current)}
              </div>
              
              <div className={`flex items-center gap-1 text-sm ${isGoodChange ? 'text-emerald-600' : 'text-red-600'}`}>
                <AppIcon 
                  name={change.positive ? 'trending_up' : 'trending_down'} 
                  size={16}
                />
                <span>{change.value.toFixed(1)}%</span>
                <span className="text-muted-foreground ml-1">
                  vs {metric.format(metric.data.previous)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="mt-6 pt-6 border-t border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border"
                >
                  <th className="text-left py-2 text-muted-foreground font-medium">Metric</th>
                  <th className="text-right py-2 text-muted-foreground font-medium">Current Period</th>
                  <th className="text-right py-2 text-muted-foreground font-medium">Previous Period</th>
                  <th className="text-right py-2 text-muted-foreground font-medium">Change</th>
                  <th className="text-right py-2 text-muted-foreground font-medium">% Change</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((metric) => {
                  const change = calculateChange(metric.data.current, metric.data.previous);
                  const absoluteChange = metric.data.current - metric.data.previous;
                  const isPositiveGood = metric.key !== 'voids';
                  const isGoodChange = isPositiveGood ? change.positive : !change.positive;

                  return (
                    <tr key={metric.key} className="border-b border-border/50">
                      <td className="py-3 font-medium text-foreground">{metric.label}</td>
                      <td className="py-3 text-right text-foreground">{metric.format(metric.data.current)}</td>
                      <td className="py-3 text-right text-muted-foreground">{metric.format(metric.data.previous)}</td>
                      <td className={`py-3 text-right font-medium ${isGoodChange ? 'text-emerald-600' : 'text-red-600'}`}>
                        {absoluteChange >= 0 ? '+' : ''}
                        {metric.format(absoluteChange)}
                      </td>
                      <td className={`py-3 text-right font-medium ${isGoodChange ? 'text-emerald-600' : 'text-red-600'}`}>
                        {change.positive ? '+' : '-'}
                        {change.value.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

interface PeriodComparisonSelectorProps {
  value: 'last7days' | 'last30days' | 'thisMonth' | 'lastMonth' | 'custom';
  onChange: (value: string, currentPeriod: { from: string; to: string }, previousPeriod: { from: string; to: string }) => void;
}

export const PeriodComparisonSelector: React.FC<PeriodComparisonSelectorProps> = ({ value, onChange }) => {
  const options = [
    { key: 'last7days', label: 'Last 7 Days vs Previous 7 Days' },
    { key: 'last30days', label: 'Last 30 Days vs Previous 30 Days' },
    { key: 'thisMonth', label: 'This Month vs Last Month' },
    { key: 'lastMonth', label: 'Last Month vs Same Month Last Year' },
  ];

  const calculatePeriods = (key: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    switch (key) {
      case 'last7days': {
        const currentEnd = new Date(today);
        const currentStart = new Date(today);
        currentStart.setDate(currentStart.getDate() - 6);
        
        const previousEnd = new Date(currentStart);
        previousEnd.setDate(previousEnd.getDate() - 1);
        const previousStart = new Date(previousEnd);
        previousStart.setDate(previousStart.getDate() - 6);
        
        return {
          current: { from: currentStart.toISOString().split('T')[0], to: currentEnd.toISOString().split('T')[0] },
          previous: { from: previousStart.toISOString().split('T')[0], to: previousEnd.toISOString().split('T')[0] },
        };
      }
      
      case 'last30days': {
        const currentEnd = new Date(today);
        const currentStart = new Date(today);
        currentStart.setDate(currentStart.getDate() - 29);
        
        const previousEnd = new Date(currentStart);
        previousEnd.setDate(previousEnd.getDate() - 1);
        const previousStart = new Date(previousEnd);
        previousStart.setDate(previousStart.getDate() - 29);
        
        return {
          current: { from: currentStart.toISOString().split('T')[0], to: currentEnd.toISOString().split('T')[0] },
          previous: { from: previousStart.toISOString().split('T')[0], to: previousEnd.toISOString().split('T')[0] },
        };
      }
      
      case 'thisMonth': {
        const currentStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const currentEnd = new Date(today);
        
        const previousEnd = new Date(currentStart);
        previousEnd.setDate(previousEnd.getDate() - 1);
        const previousStart = new Date(previousEnd.getFullYear(), previousEnd.getMonth(), 1);
        
        return {
          current: { from: currentStart.toISOString().split('T')[0], to: currentEnd.toISOString().split('T')[0] },
          previous: { from: previousStart.toISOString().split('T')[0], to: previousEnd.toISOString().split('T')[0] },
        };
      }
      
      case 'lastMonth': {
        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
        
        const yearAgoStart = new Date(lastMonth.getFullYear() - 1, lastMonth.getMonth(), 1);
        const yearAgoEnd = new Date(lastMonthEnd.getFullYear() - 1, lastMonthEnd.getMonth() + 1, 0);
        
        return {
          current: { from: lastMonth.toISOString().split('T')[0], to: lastMonthEnd.toISOString().split('T')[0] },
          previous: { from: yearAgoStart.toISOString().split('T')[0], to: yearAgoEnd.toISOString().split('T')[0] },
        };
      }
      
      default:
        return { current: { from: '', to: '' }, previous: { from: '', to: '' } };
    }
  };

  const handleChange = (key: string) => {
    const periods = calculatePeriods(key);
    onChange(key, periods.current, periods.previous);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => handleChange(opt.key)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            value === opt.key
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
};
