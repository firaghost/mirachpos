import React, { useEffect } from 'react';

interface Props {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
}

export const Modal: React.FC<Props> = ({ open, title, children, onClose, footer }) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed top-0 bottom-0 right-0 left-64 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-[#483c23] bg-[#2c241b] text-white shadow-2xl">
        <div className="px-6 py-4 border-b border-[#483c23] flex items-center justify-between">
          <div className="text-lg font-bold">{title}</div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg bg-[#3a2e22] hover:bg-[#4a3b2b] border border-[#483c23] flex items-center justify-center transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer ? <div className="px-6 py-4 border-t border-[#483c23] bg-[#221c11] rounded-b-2xl">{footer}</div> : null}
      </div>
    </div>
  );
};
