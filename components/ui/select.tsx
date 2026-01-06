import * as React from 'react';
import { cn } from '../lib/utils';

type SelectContextValue = {
  value: string;
  setValue: (v: string) => void;
  open: boolean;
  setOpen: (o: boolean) => void;
};

const SelectContext = React.createContext<SelectContextValue | null>(null);

export const Select: React.FC<{ value?: string; defaultValue?: string; onValueChange?: (v: string) => void; children: React.ReactNode }>
  = ({ value, defaultValue, onValueChange, children }) => {
    const [internal, setInternal] = React.useState(defaultValue ?? '');
    const [open, setOpen] = React.useState(false);
    const current = value ?? internal;

    const setValue = (v: string) => {
      if (value == null) setInternal(v);
      onValueChange?.(v);
      setOpen(false);
    };

    return (
      <SelectContext.Provider value={{ value: current, setValue, open, setOpen }}>{children}</SelectContext.Provider>
    );
  };

export const SelectTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, children, ...props }, ref) => {
    const ctx = React.useContext(SelectContext);
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        onClick={(e) => {
          props.onClick?.(e);
          ctx?.setOpen(!ctx.open);
        }}
        {...props}
      >
        {children}
      </button>
    );
  },
);
SelectTrigger.displayName = 'SelectTrigger';

export const SelectValue: React.FC<{ placeholder?: string; className?: string }> = ({ placeholder, className }) => {
  const ctx = React.useContext(SelectContext);
  const v = ctx?.value ?? '';
  return <span className={cn('truncate', className)}>{v || placeholder || ''}</span>;
};

export const SelectContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...props }) => {
  const ctx = React.useContext(SelectContext);
  if (!ctx?.open) return null;
  return (
    <div className={cn('mt-1 w-full rounded-md border border-border bg-background shadow-lg', className)} {...props}>
      <div className="p-1">{children}</div>
    </div>
  );
};

export const SelectItem: React.FC<React.HTMLAttributes<HTMLDivElement> & { value: string }> = ({ className, value, children, ...props }) => {
  const ctx = React.useContext(SelectContext);
  const selected = ctx?.value === value;
  return (
    <div
      role="option"
      aria-selected={selected}
      className={cn(
        'cursor-pointer select-none rounded-sm px-2 py-1.5 text-sm hover:bg-muted',
        selected ? 'bg-muted' : '',
        className,
      )}
      onClick={(e) => {
        props.onClick?.(e as any);
        ctx?.setValue(value);
      }}
      {...props}
    >
      {children}
    </div>
  );
};

export const SelectGroup: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('py-1', className)} {...props} />
);

export const SelectLabel: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('px-2 py-1 text-xs font-semibold text-muted-foreground', className)} {...props} />
);

export const SelectSeparator: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div className={cn('my-1 h-px bg-border', className)} {...props} />
);
