import * as React from "react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "./focus";

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  count?: number;
  icon?: React.ReactNode;
}

/** Toggleable filter/quick-action chip with optional count badge. */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ active = false, count, icon, className, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-control border px-2 text-xs transition-colors",
        FOCUS_RING,
        "[&_svg]:h-3 [&_svg]:w-3 [&_svg]:shrink-0",
        active
          ? "border-border-control bg-surface-control font-medium text-text-strong"
          : "border-border-control text-text-secondary hover:bg-surface-hover hover:text-text",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
      {typeof count === "number" && (
        <span
          className={cn(
            "rounded-control px-1 font-mono text-2xs tabular-nums",
            active ? "text-text-secondary" : "text-text-tertiary",
          )}
        >
          {count}
        </span>
      )}
    </button>
  ),
);
Chip.displayName = "Chip";
