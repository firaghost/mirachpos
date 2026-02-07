import React, { useState, useCallback, useMemo } from 'react';
import { apiFetch } from '../api';
import { readSession } from '../session';
import { formatCurrency, formatDate } from '../utils/exportUtils';
import { AppIcon } from '@/components/ui/app-icon';

type ReportField = 
  | 'orderId' | 'orderDate' | 'customerName' | 'staffName' 
  | 'branchName' | 'productName' | 'category' | 'quantity' 
  | 'unitPrice' | 'discount' | 'tax' | 'tip' | 'total' 
  | 'paymentMethod' | 'status';

type FilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';

interface Filter {
  id: string;
  field: ReportField | '';
  operator: FilterOperator;
  value: string;
}

interface GroupBy {
  field: ReportField | '';
  aggregation: 'sum' | 'count' | 'avg' | 'min' | 'max';
}

interface CustomReportConfig {
  name: string;
  fields: ReportField[];
  filters: Filter[];
  groupBy?: GroupBy;
  sortBy: { field: ReportField; direction: 'asc' | 'desc' };
  dateRange: { from: string; to: string };
}

const AVAILABLE_FIELDS: { key: ReportField; label: string; type: 'text' | 'number' | 'date' | 'money' }[] = [
  { key: 'orderId', label: 'Order ID', type: 'text' },
  { key: 'orderDate', label: 'Order Date', type: 'date' },
  { key: 'customerName', label: 'Customer', type: 'text' },
  { key: 'staffName', label: 'Staff', type: 'text' },
  { key: 'branchName', label: 'Branch', type: 'text' },
  { key: 'productName', label: 'Product', type: 'text' },
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'quantity', label: 'Quantity', type: 'number' },
  { key: 'unitPrice', label: 'Unit Price', type: 'money' },
  { key: 'discount', label: 'Discount', type: 'money' },
  { key: 'tax', label: 'Tax', type: 'money' },
  { key: 'tip', label: 'Tip', type: 'money' },
  { key: 'total', label: 'Total', type: 'money' },
  { key: 'paymentMethod', label: 'Payment Method', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
];

const OPERATORS: { key: FilterOperator; label: string; types: string[] }[] = [
  { key: 'eq', label: 'Equals', types: ['text', 'number', 'date', 'money'] },
  { key: 'neq', label: 'Not Equals', types: ['text', 'number', 'date', 'money'] },
  { key: 'gt', label: 'Greater Than', types: ['number', 'date', 'money'] },
  { key: 'gte', label: 'Greater or Equal', types: ['number', 'date', 'money'] },
  { key: 'lt', label: 'Less Than', types: ['number', 'date', 'money'] },
  { key: 'lte', label: 'Less or Equal', types: ['number', 'date', 'money'] },
  { key: 'contains', label: 'Contains', types: ['text'] },
  { key: 'in', label: 'In List (comma separated)', types: ['text'] },
];

const AGGREGATIONS = [
  { key: 'sum', label: 'Sum' },
  { key: 'count', label: 'Count' },
  { key: 'avg', label: 'Average' },
  { key: 'min', label: 'Minimum' },
  { key: 'max', label: 'Maximum' },
];

export const CustomReportBuilder: React.FC = () => {
  const [config, setConfig] = useState<CustomReportConfig>({
    name: 'My Custom Report',
    fields: ['orderDate', 'customerName', 'productName', 'quantity', 'total'],
    filters: [],
    sortBy: { field: 'orderDate', direction: 'desc' },
    dateRange: { from: '', to: '' },
  });
  
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'configure' | 'preview'>('configure');
  const [savedConfigs, setSavedConfigs] = useState<CustomReportConfig[]>([]);

  const today = useMemo(() => new Date().toISOString().split('T')[0], []);

  const addField = (field: ReportField) => {
    if (!config.fields.includes(field)) {
      setConfig((prev) => ({ ...prev, fields: [...prev.fields, field] }));
    }
  };

  const removeField = (field: ReportField) => {
    setConfig((prev) => ({ ...prev, fields: prev.fields.filter((f) => f !== field) }));
  };

  const addFilter = () => {
    const newFilter: Filter = {
      id: Math.random().toString(36).substr(2, 9),
      field: '',
      operator: 'eq',
      value: '',
    };
    setConfig((prev) => ({ ...prev, filters: [...prev.filters, newFilter] }));
  };

  const updateFilter = (id: string, updates: Partial<Filter>) => {
    setConfig((prev) => ({
      ...prev,
      filters: prev.filters.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    }));
  };

  const removeFilter = (id: string) => {
    setConfig((prev) => ({ ...prev, filters: prev.filters.filter((f) => f.id !== id) }));
  };

  const getFieldType = (field: ReportField): string => {
    return AVAILABLE_FIELDS.find((f) => f.key === field)?.type || 'text';
  };

  const getAvailableOperators = (fieldType: string) => {
    return OPERATORS.filter((op) => op.types.includes(fieldType));
  };

  const runReport = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const session = readSession<any>();
      if (!session?.token) throw new Error('Not authenticated');

      const params = new URLSearchParams();
      params.set('from', config.dateRange.from || today);
      params.set('to', config.dateRange.to || today);
      params.set('fields', config.fields.join(','));
      params.set('sortBy', config.sortBy.field);
      params.set('sortDirection', config.sortBy.direction);
      
      if (config.groupBy?.field) {
        params.set('groupBy', config.groupBy.field);
        params.set('aggregation', config.groupBy.aggregation);
      }

      config.filters.forEach((filter, idx) => {
        if (filter.field && filter.value) {
          params.set(`filter[${idx}][field]`, filter.field);
          params.set(`filter[${idx}][operator]`, filter.operator);
          params.set(`filter[${idx}][value]`, filter.value);
        }
      });

      const res = await apiFetch(`/api/owner/reports/custom?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch report data');

      const result = await res.json();
      if (!result.ok) throw new Error(result.error || 'Report failed');

      setData(result.data || []);
      setActiveTab('preview');
    } catch (err: any) {
      setError(err.message || 'Failed to run report');
    } finally {
      setLoading(false);
    }
  }, [config, today]);

  const exportToExcel = useCallback(async () => {
    try {
      const session = readSession<any>();
      if (!session?.token) return;

      const params = new URLSearchParams();
      params.set('from', config.dateRange.from || today);
      params.set('to', config.dateRange.to || today);
      params.set('fields', config.fields.join(','));
      params.set('format', 'xlsx');

      const res = await apiFetch(`/api/owner/reports/custom/export?${params.toString()}`);
      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${config.name.replace(/\s+/g, '_')}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Export failed');
    }
  }, [config, today]);

  const saveConfig = () => {
    setSavedConfigs((prev) => [...prev, { ...config }]);
    alert('Report configuration saved!');
  };

  const loadConfig = (saved: CustomReportConfig) => {
    setConfig(saved);
  };

  const formatCellValue = (value: any, field: ReportField) => {
    const fieldDef = AVAILABLE_FIELDS.find((f) => f.key === field);
    if (!fieldDef) return value;

    switch (fieldDef.type) {
      case 'money':
        return formatCurrency(Number(value) || 0);
      case 'date':
        return formatDate(value);
      case 'number':
        return Number(value).toLocaleString();
      default:
        return value;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AppIcon name="build" className="text-primary" size={28} />
          <div>
            <h2 className="text-xl font-bold text-foreground">Custom Report Builder</h2>
            <p className="text-sm text-muted-foreground">Build and export custom reports</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('configure')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'configure'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            Configure
          </button>
          <button
            onClick={() => setActiveTab('preview')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'preview'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
            disabled={data.length === 0}
          >
            Preview ({data.length})
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {activeTab === 'configure' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-6">
            {/* Report Name */}
            <div className="bg-card border border-border rounded-xl p-6">
              <label className="block text-sm font-medium text-foreground mb-2">Report Name</label>
              <input
                type="text"
                value={config.name}
                onChange={(e) => setConfig((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
              />
            </div>

            {/* Date Range */}
            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <AppIcon name="calendar_today" size={18} /> Date Range
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">From</label>
                  <input
                    type="date"
                    value={config.dateRange.from}
                    onChange={(e) => setConfig((prev) => ({
                      ...prev,
                      dateRange: { ...prev.dateRange, from: e.target.value },
                    }))}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">To</label>
                  <input
                    type="date"
                    value={config.dateRange.to}
                    onChange={(e) => setConfig((prev) => ({
                      ...prev,
                      dateRange: { ...prev.dateRange, to: e.target.value },
                    }))}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg"
                  />
                </div>
              </div>
            </div>

            {/* Fields Selection */}
            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <AppIcon name="view_column" size={18} /> Fields ({config.fields.length})
              </h3>

              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_FIELDS.map((field) => (
                    <button
                      key={field.key}
                      onClick={() =>
                        config.fields.includes(field.key)
                          ? removeField(field.key)
                          : addField(field.key)
                      }
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        config.fields.includes(field.key)
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      {field.label}
                    </button>
                  ))}
                </div>

                {config.fields.length > 0 && (
                  <div className="pt-3 border-t border-border">
                    <p className="text-xs text-muted-foreground mb-2">Selected order (drag to reorder - not implemented):</p>
                    <div className="flex flex-wrap gap-2">
                      {config.fields.map((field) => {
                        const fieldDef = AVAILABLE_FIELDS.find((f) => f.key === field);
                        return (
                          <span
                            key={field}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary rounded-full text-xs"
                          >
                            {fieldDef?.label}
                            <button
                              onClick={() => removeField(field)}
                              className="hover:text-red-500"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Filters */}
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <AppIcon name="filter_list" size={18} /> Filters
                </h3>
                <button
                  onClick={addFilter}
                  className="text-xs px-3 py-1.5 bg-primary/10 text-primary rounded-lg hover:bg-primary/20"
                >
                  + Add Filter
                </button>
              </div>

              {config.filters.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No filters applied</p>
              ) : (
                <div className="space-y-3">
                  {config.filters.map((filter) => {
                    const fieldType = getFieldType(filter.field as ReportField);
                    const availableOperators = getAvailableOperators(fieldType);

                    return (
                      <div key={filter.id} className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                        <select
                          value={filter.field}
                          onChange={(e) => updateFilter(filter.id, { field: e.target.value as ReportField, operator: 'eq' })}
                          className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm"
                        >
                          <option value="">Select field...</option>
                          {AVAILABLE_FIELDS.map((f) => (
                            <option key={f.key} value={f.key}>{f.label}</option>
                          ))}
                        </select>

                        <select
                          value={filter.operator}
                          onChange={(e) => updateFilter(filter.id, { operator: e.target.value as FilterOperator })}
                          className="px-3 py-2 bg-background border border-border rounded-lg text-sm"
                          disabled={!filter.field}
                        >
                          {availableOperators.map((op) => (
                            <option key={op.key} value={op.key}>{op.label}</option>
                          ))}
                        </select>

                        <input
                          type="text"
                          value={filter.value}
                          onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                          placeholder="Value..."
                          className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm"
                        />

                        <button
                          onClick={() => removeFilter(filter.id)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                        >
                          <AppIcon name="delete" size={18} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Group By */}
            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <AppIcon name="group_work" size={18} /> Group By (Optional)
              </h3>

              <div className="flex items-center gap-3">
                <select
                  value={config.groupBy?.field || ''}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      groupBy: e.target.value
                        ? { field: e.target.value as ReportField, aggregation: prev.groupBy?.aggregation || 'sum' }
                        : undefined,
                    }))
                  }
                  className="flex-1 px-3 py-2 bg-background border border-border rounded-lg"
                >
                  <option value="">No grouping</option>
                  {AVAILABLE_FIELDS.filter((f) => f.type === 'text').map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>

                {config.groupBy?.field && (
                  <select
                    value={config.groupBy.aggregation}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        groupBy: prev.groupBy
                          ? { ...prev.groupBy, aggregation: e.target.value as any }
                          : undefined,
                      }))
                    }
                    className="px-3 py-2 bg-background border border-border rounded-lg"
                  >
                    {AGGREGATIONS.map((agg) => (
                      <option key={agg.key} value={agg.key}>{agg.label}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Sort */}
            <div className="bg-card border border-border rounded-xl p-6">
              <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                <AppIcon name="sort" size={18} /> Sort By
              </h3>

              <div className="flex items-center gap-3">
                <select
                  value={config.sortBy.field}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      sortBy: { ...prev.sortBy, field: e.target.value as ReportField },
                    }))
                  }
                  className="flex-1 px-3 py-2 bg-background border border-border rounded-lg"
                >
                  {AVAILABLE_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>

                <select
                  value={config.sortBy.direction}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      sortBy: { ...prev.sortBy, direction: e.target.value as 'asc' | 'desc' },
                    }))
                  }
                  className="px-3 py-2 bg-background border border-border rounded-lg"
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Preview Tab */
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-foreground">{config.name} - Preview</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={exportToExcel}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
              >
                <AppIcon name="download" size={18} /> Export Excel
              </button>
            </div>
          </div>

          {data.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No data to display. Run the report to see results.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50">
                    {config.fields.map((field) => {
                      const fieldDef = AVAILABLE_FIELDS.find((f) => f.key === field);
                      return (
                        <th key={field} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                          {fieldDef?.label}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, idx) => (
                    <tr key={idx} className="border-b border-border/50 hover:bg-muted/30">
                      {config.fields.map((field) => (
                        <td key={field} className="px-4 py-3 text-sm text-foreground">
                          {formatCellValue(row[field], field)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <div className="flex items-center gap-2">
          {savedConfigs.length > 0 && (
            <select
              onChange={(e) => {
                const config = savedConfigs[parseInt(e.target.value)];
                if (config) loadConfig(config);
              }}
              className="px-3 py-2 bg-background border border-border rounded-lg text-sm"
            >
              <option value="">Load saved report...</option>
              {savedConfigs.map((c, idx) => (
                <option key={idx} value={idx}>{c.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={saveConfig}
            className="px-4 py-2 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80"
          >
            Save Configuration
          </button>
        </div>

        <button
          onClick={runReport}
          disabled={loading || config.fields.length === 0}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? (
            <>
              <AppIcon name="refresh" className="animate-spin" size={20} />
              Running...
            </>
          ) : (
            <>
              <AppIcon name="play_arrow" size={20} />
              Run Report
            </>
          )}
        </button>
      </div>
    </div>
  );
};
