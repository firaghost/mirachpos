import React from 'react';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxWidth?: string;
};

export const Modal: React.FC<Props> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-hidden rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-2">
          <div className="text-sm font-bold">{title || 'Modal'}</div>
          <button type="button" className="text-sm font-bold opacity-70 hover:opacity-100" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="p-3 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};
