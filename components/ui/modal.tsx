import React from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
};

export const Modal: React.FC<Props> = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <div className="fixed top-0 bottom-0 right-0 left-64 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
          <div className="text-sm font-bold">{title || 'Modal'}</div>
          <button type="button" className="text-sm font-bold opacity-70 hover:opacity-100" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
};
