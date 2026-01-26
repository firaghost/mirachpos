import React, { useMemo, useState } from 'react';
import { apiFetch } from '../api';
import { Modal } from './Modal';

type Props = {
  open: boolean;
  onClose: () => void;
  onInitialized?: () => void;
};

const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(' ');

export const InitializePosModal: React.FC<Props> = ({ open, onClose, onInitialized }) => {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string>('');

  const [tablesCount, setTablesCount] = useState('12');
  const [defaultSeats, setDefaultSeats] = useState('4');
  const [defaultArea, setDefaultArea] = useState<'Main Hall' | 'Patio' | 'Bar Area' | 'Private Room'>('Main Hall');

  const payload = useMemo(() => {
    const count = Math.max(1, Math.min(200, Number(tablesCount) || 0));
    const seats = Math.max(1, Math.min(20, Number(defaultSeats) || 0));
    return { tablesCount: count, defaultSeats: seats, defaultArea };
  }, [defaultArea, defaultSeats, tablesCount]);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setErr('');
    try {
      const res = await apiFetch('/api/pos/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      onClose();
      onInitialized && onInitialized();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to initialize POS');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Initialize POS"
      onClose={() => {
        if (saving) return;
        setErr('');
        onClose();
      }}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="h-10 px-4 rounded-lg border border-border bg-secondary text-foreground font-bold hover:bg-secondary/80 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="h-10 px-4 rounded-lg bg-primary text-primary-foreground font-black hover:bg-primary/90 disabled:opacity-60"
          >
            {saving ? 'Initializing ¦' : 'Initialize'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {err ? <div className="text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded-lg p-3">{err}</div> : null}

        <div className="text-sm text-muted-foreground">
          This will create default tables for the current branch. Products and menu items will remain empty until you add them.
        </div>

        <div className="grid grid-cols-12 gap-4">
          <label className="col-span-6 flex flex-col gap-1">
            <span className="text-xs text-muted-foreground font-bold">Tables count</span>
            <input
              value={tablesCount}
              onChange={(e) => setTablesCount(e.target.value)}
              className={cx('h-10 rounded-lg px-3 bg-background border border-border text-foreground outline-none')}
              inputMode="numeric"
            />
          </label>

          <label className="col-span-6 flex flex-col gap-1">
            <span className="text-xs text-muted-foreground font-bold">Default seats</span>
            <input
              value={defaultSeats}
              onChange={(e) => setDefaultSeats(e.target.value)}
              className={cx('h-10 rounded-lg px-3 bg-background border border-border text-foreground outline-none')}
              inputMode="numeric"
            />
          </label>

          <label className="col-span-12 flex flex-col gap-1">
            <span className="text-xs text-muted-foreground font-bold">Default area</span>
            <select
              value={defaultArea}
              onChange={(e) => setDefaultArea(e.target.value as any)}
              className="h-10 rounded-lg px-3 bg-background border border-border text-foreground outline-none"
            >
              <option value="Main Hall">Main Hall</option>
              <option value="Patio">Patio</option>
              <option value="Bar Area">Bar Area</option>
              <option value="Private Room">Private Room</option>
            </select>
          </label>
        </div>
      </div>
    </Modal>
  );
};
