import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLatest } from '../../lib/hooks.ts';

type Placement = 'bottom-start' | 'bottom-end' | 'bottom' | 'top';

interface PopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  placement?: Placement;
  className?: string;
  label?: string;
  children: ReactNode;
}

const GAP = 8;
const MARGIN = 8;

/** Floating panel anchored to an element. Closes on outside press and Escape. */
export function Popover({ anchor, open, onClose, placement = 'bottom-start', className = '', label, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const onCloseRef = useLatest(onClose);

  const reposition = useCallback(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    let top = placement === 'top' ? a.top - height - GAP : a.bottom + GAP;
    if (placement !== 'top' && top + height > window.innerHeight - MARGIN && a.top - height - GAP > MARGIN) top = a.top - height - GAP;
    if (placement === 'top' && top < MARGIN) top = a.bottom + GAP;
    let left =
      placement === 'bottom-start' ? a.left : placement === 'bottom-end' ? a.right - width : a.left + a.width / 2 - width / 2;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - width - MARGIN));
    top = Math.max(MARGIN, top);
    setPosition((current) => (current && current.top === top && current.left === left ? current : { top, left }));
  }, [anchor, placement]);

  // The anchor can move when the table re-arranges (players joining/leaving): follow it.
  useLayoutEffect(() => {
    if (open) reposition();
  });

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    reposition();
    const observer = new ResizeObserver(reposition);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

  useLayoutEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor?.contains(target)) return;
      onCloseRef.current();
    };
    // Capture phase on window: runs before modal handlers, so Escape only closes the popover.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onCloseRef.current();
      anchor?.focus();
    };
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchor, onCloseRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={`popover ${className}`}
      role="dialog"
      aria-label={label}
      style={{ top: position?.top ?? -9999, left: position?.left ?? -9999, visibility: position ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Popover state bound to a trigger button. */
export function usePopover() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const toggle = useCallback((event: { currentTarget: HTMLElement }) => {
    setAnchor(event.currentTarget);
    setOpen((value) => !value);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return { anchor, open, toggle, close, setAnchor, setOpen };
}
