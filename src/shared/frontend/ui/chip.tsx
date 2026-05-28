import * as React from "react";
import { cn } from "@/lib/utils";

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
        "inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-violet-400 bg-accent-soft text-accent-text dark:border-violet-600"
          : "border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
      {typeof count === "number" && (
        <span
          className={cn(
            "rounded-pill px-1.5 text-[10px] tabular-nums",
            active
              ? "bg-violet-500/20"
              : "bg-slate-200/70 dark:bg-slate-700/70",
          )}
        >
          {count}
        </span>
      )}
    </button>
  ),
);
Chip.displayName = "Chip";
