import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

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
}

/**
 * A floating, canvas-anchored comment marker. On-screen → a numbered teardrop
 * whose tip sits on the anchor; off-screen → a small edge chip that recenters
 * the camera on click.
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
}: CommentPinProps): ReactElement {
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

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "pointer-events-auto absolute z-20 -translate-x-1/2 -translate-y-full cursor-pointer transition-transform focus:outline-none",
        active ? "scale-110" : "hover:scale-110",
        resolved && !active && "scale-90 opacity-60 hover:opacity-90",
      )}
      style={{ left: x, top: y }}
    >
      <span className="relative flex h-7 w-7 items-center justify-center">
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rotate-45 rounded-full rounded-br-none shadow-md",
            active && "ring-2 ring-white dark:ring-slate-900",
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
