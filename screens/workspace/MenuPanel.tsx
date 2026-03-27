import React, { useMemo, useState } from 'react';

import { usePos } from '../../PosContext';

import { AppIcon } from '@/components/ui/app-icon';
import { cn } from '@/components/lib/utils';

export type MenuPanelProps = {
  selectedTableId: string | null;
  onAddItem: (productId: string) => void;
};

export const MenuPanel: React.FC<MenuPanelProps> = ({ selectedTableId, onAddItem }) => {
  const { products } = usePos();

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const c = String(p.category || '').trim();
      if (c) set.add(c);
    }
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [products]);

  const [category, setCategory] = useState<string>('All');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if ((p as any)?.available === false) return false;
      if (p.stock <= 0) return false;
      if (category !== 'All' && String(p.category || '').trim() !== category) return false;
      if (!q) return true;
      return String(p.name || '').toLowerCase().includes(q) || String(p.code || '').toLowerCase().includes(q);
    });
  }, [products, category, query]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="p-3 border-b border-border bg-card">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-black uppercase tracking-widest text-foreground">Menu</div>
          <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            {selectedTableId ? `Table: ${selectedTableId}` : 'Select a table'}
          </div>
        </div>

        <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={cn(
                'h-8 px-3 rounded-full border text-[11px] font-black uppercase tracking-widest whitespace-nowrap',
                category === c
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:text-foreground'
              )}
              onPointerDown={(e) => {
                e.preventDefault();
                setCategory(c);
              }}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="mt-2 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <AppIcon name="search" className="text-muted-foreground" size={18} />
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10 w-full pl-10 pr-3 rounded-lg border border-border bg-background text-sm text-foreground placeholder-muted-foreground focus:outline-none"
            placeholder="Search items"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              className={cn(
                'rounded-xl border border-border bg-background p-3 text-left hover:border-primary/40 transition-colors',
                !selectedTableId ? 'opacity-60' : ''
              )}
              onPointerDown={(e) => {
                e.preventDefault();
                if (!selectedTableId) return;
                onAddItem(p.id);
              }}
              disabled={!selectedTableId}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-foreground font-black text-sm leading-tight">{p.name}</div>
                  <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">{p.category}</div>
                </div>
                <div className="text-xs font-black text-foreground">ETB {Number(p.price || 0).toFixed(2)}</div>
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground font-semibold">Stock: {p.stock}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
