import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type PortalMenuAnchorRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export const PortalMenu: React.FC<{
  open: boolean;
  anchorRect: PortalMenuAnchorRect | null;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}> = ({ open, anchorRect, onClose, width = 224, children }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const body = useMemo(() => {
    try {
      return typeof document !== 'undefined' ? document.body : null;
    } catch {
      return null;
    }
  }, []);

  useLayoutEffect(() => {
    if (!open || !anchorRect) {
      setPos(null);
      return;
    }

    const gap = 8;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0;

    const targetWidth = Math.max(160, Math.min(width, vw - 16));

    let left = anchorRect.right - targetWidth;
    let top = anchorRect.bottom + gap;

    left = Math.max(8, Math.min(left, vw - targetWidth - 8));

    const estimatedHeight = ref.current?.getBoundingClientRect().height || 240;
    if (top + estimatedHeight > vh - 8) {
      const upTop = anchorRect.top - gap - estimatedHeight;
      if (upTop >= 8) top = upTop;
    }

    setPos({ top, left });
  }, [open, anchorRect, width]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const onMouseDown = (e: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      if (!el.contains(e.target as any)) onClose();
    };

    const onResize = () => onClose();
    const onScroll = () => onClose();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, onClose]);

  if (!open || !anchorRect || !body) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999]"
      style={{ pointerEvents: 'none' }}
      aria-hidden
    >
      <div
        ref={ref}
        className="rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl overflow-hidden"
        style={{
          pointerEvents: 'auto',
          position: 'fixed',
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
          width,
        }}
        role="menu"
      >
        {children}
      </div>
    </div>,
    body,
  );
};
