import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A small draggable circle that fills a long form with plausible values.
 *
 * Built for reviewing/testing the app on a phone: typing a whole service order
 * (customer, phone, address, problem, price, notes) or a completion report just
 * to check a screen is slow and error-prone, so each long form gets one tap that
 * fills it with realistic data. It is draggable because it must never sit on top
 * of the field you are trying to read, and it remembers where you put it.
 *
 * Only rendered where a form is open — see the pages that use it.
 */
const POS_KEY = 'ss_demofill_pos_v1';
const SIZE = 52; // px, a comfortable one-thumb target

function clamp(pos: { x: number; y: number }) {
  const maxX = Math.max(8, window.innerWidth - SIZE - 8);
  const maxY = Math.max(8, window.innerHeight - SIZE - 8);
  return { x: Math.min(Math.max(8, pos.x), maxX), y: Math.min(Math.max(8, pos.y), maxY) };
}

function readStored(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { x: number; y: number };
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed;
  } catch {
    /* ignore a corrupt value and fall back to the default corner */
  }
  return null;
}

export function DemoFillButton({
  onFill,
  label = 'Fill this form with sample data',
}: {
  onFill: () => void;
  label?: string;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number; startX: number; startY: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const stored = readStored();
    // Default: bottom-right, clear of the primary action buttons on the left.
    setPos(clamp(stored ?? { x: window.innerWidth - SIZE - 16, y: window.innerHeight - 120 }));
    const onResize = () => setPos((p) => (p ? clamp(p) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!pos) return;
      drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, startX: e.clientX, startY: e.clientY, moved: false };
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [pos],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    const next = clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
    // A few pixels of slop: fingers wobble, and a wobble must still count as a tap.
    if (Math.hypot(e.clientX - drag.current.startX, e.clientY - drag.current.startY) > 6) {
      drag.current.moved = true;
    }
    setPos(next);
  }, []);

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!drag.current) return;
      const moved = drag.current.moved;
      drag.current = null;
      setDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
      setPos((p) => {
        if (p) {
          try {
            localStorage.setItem(POS_KEY, JSON.stringify(p));
          } catch {
            /* storage full or blocked — the position just won't persist */
          }
        }
        return p;
      });
      // A drag is not a tap — remember it so the click that follows a drag is
      // ignored, while a plain click (mouse, keyboard, assistive tech) fills.
      dragged.current = moved;
    },
    [onFill],
  );

  if (!pos) return null;

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={() => {
        if (dragged.current) {
          dragged.current = false; // swallow the click that ends a drag
          return;
        }
        onFill();
      }}
      style={{ left: pos.x, top: pos.y, width: SIZE, height: SIZE, touchAction: 'none' }}
      className={`fixed z-[70] grid cursor-grab place-items-center rounded-full border-2 border-white bg-amber-500 text-2xl text-white shadow-lg transition-transform active:scale-95 ${
        dragging ? 'cursor-grabbing scale-105' : 'hover:bg-amber-600'
      }`}
    >
      <span aria-hidden>✨</span>
    </button>
  );
}
