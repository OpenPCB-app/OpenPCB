import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
} from "react";
import { cn } from "@/lib/utils";

const DRAG_THRESHOLD_PX = 4;

export interface CommentPinProps {
  index: number;
  color: string;
  active: boolean;
  resolved: boolean;
  /** Wrapper-relative screen pixels. For on-screen pins this is the tip; for
   *  clamped (off-screen) pins it is the edge position (centre of the chip). */
  x: number;
  y: number;
  /** Off-screen → render a small edge chip that recenters instead of a pin. */
  clamped: boolean;
  title?: string;
  onClick: () => void;
  /** Commit a drag: final wrapper-relative screen position of the pin tip.
   *  Only wired for on-screen pins. */
  onMoveEnd?: (screen: { x: number; y: number }) => void;
}

/**
 * A floating, canvas-anchored comment marker. On-screen → a numbered teardrop
 * whose tip sits on the anchor (draggable to reposition); off-screen → a small
 * edge chip that recenters the camera on click.
 */
export function CommentPin({
  index,
  color,
  active,
  resolved,
  x,
  y,
  clamped,
  title,
  onClick,
  onMoveEnd,
}: CommentPinProps): ReactElement {
  // Live drag offset (px) while the pointer is down; null when idle.
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const startRef = useRef<{ x: number; y: number; moved: boolean } | null>(
    null,
  );

  // After a move-release we keep the offset so the pin stays at the drop point
  // until the committed anchor re-projects (avoids a snap-back flicker during
  // the dispatch round-trip). The reprojected x/y change clears it; a timeout
  // is the safety net for a no-op move that doesn't shift the projected pixel.
  useEffect(() => {
    if (!startRef.current) setDrag(null);
  }, [x, y]);

  if (clamped) {
    return (
      <button
        type="button"
        title={title ?? "Off-screen comment — click to reveal"}
        onClick={onClick}
        className="pointer-events-auto absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-transform hover:scale-110 focus:outline-none"
        style={{ left: x, top: y }}
      >
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white shadow ring-2 ring-white/70 dark:ring-slate-900/70"
          style={{ backgroundColor: color, opacity: 0.85 }}
        >
          {index}
        </span>
      </button>
    );
  }

  const draggable = !!onMoveEnd;
  const dragging = drag !== null && (startRef.current?.moved ?? false);

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (!draggable || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = { x: e.clientX, y: e.clientY, moved: false };
    setDrag({ dx: 0, dy: 0 });
  };

  const handlePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const start = startRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      start.moved = true;
    }
    setDrag({ dx, dy });
  };

  const handlePointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const start = startRef.current;
    const offset = drag;
    startRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (start?.moved && offset && onMoveEnd) {
      // Keep `offset` applied (don't clear `drag`) until the reprojected
      // anchor lands; the [x,y] effect clears it. Safety-clear after 1s.
      onMoveEnd({ x: x + offset.dx, y: y + offset.dy });
      window.setTimeout(() => setDrag(null), 1000);
    } else {
      setDrag(null);
      onClick();
    }
  };

  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        // When draggable, open/move is decided in pointerUp; swallow the native
        // click so a drag-release never double-fires. Otherwise open directly.
        if (draggable) e.preventDefault();
        else onClick();
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={draggable ? handlePointerMove : undefined}
      onPointerUp={draggable ? handlePointerUp : undefined}
      className={cn(
        "pointer-events-auto absolute z-20 -translate-x-1/2 -translate-y-full select-none focus:outline-none",
        dragging ? "cursor-grabbing" : "cursor-grab",
        !dragging &&
          (active ? "scale-110" : "transition-transform hover:scale-110"),
        resolved &&
          !active &&
          !dragging &&
          "scale-90 opacity-60 hover:opacity-90",
      )}
      style={{
        left: x + (drag?.dx ?? 0),
        top: y + (drag?.dy ?? 0),
        touchAction: "none",
      }}
    >
      <span className="relative flex h-7 w-7 items-center justify-center">
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rotate-45 rounded-full rounded-br-none shadow-md",
            (active || dragging) && "ring-2 ring-white dark:ring-slate-900",
          )}
          style={{ backgroundColor: color }}
        />
        <span className="relative text-[11px] font-semibold leading-none text-white">
          {index}
        </span>
      </span>
    </button>
  );
}
