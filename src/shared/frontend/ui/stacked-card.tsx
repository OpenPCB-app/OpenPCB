import * as React from "react";
import { cn } from "@/lib/utils";

export type StackedCardTone = "default" | "accent" | "warning";

const TONES: Record<StackedCardTone, string> = {
  default: "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900",
  accent:
    "border-violet-300 bg-accent-soft dark:border-violet-800/70 dark:bg-violet-950/20",
  warning: "border-amber-300 bg-status-warning-soft dark:border-amber-800/60",
};

export interface StackedCardProps {
  /** Collapsed summary row (always visible). Clicking it toggles expansion. */
  summary: React.ReactNode;
  /**
   * Optional action controls rendered as SIBLINGS of the toggle button (not
   * nested inside it, which would be invalid HTML for interactive children).
   */
  actions?: React.ReactNode;
  /** Expanded body, rendered only when `open`. */
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  tone?: StackedCardTone;
  className?: string;
}

/**
 * Accordion card: compact summary header → click-to-expand inline body.
 * Caller owns `open` state to enforce single-open behavior across a list.
 */
export function StackedCard({
  summary,
  actions,
  children,
  open,
  onToggle,
  tone = "default",
  className,
}: StackedCardProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-control border transition-colors",
        TONES[tone],
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {summary}
        </button>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        ) : null}
      </div>
      {open && (
        <div className="border-t border-slate-200 px-3.5 py-3.5 dark:border-slate-700/70">
          {children}
        </div>
      )}
    </div>
  );
}
