import * as React from "react";
import { cn } from "@/lib/utils";

export type PillTone = "success" | "warning" | "danger" | "neutral" | "accent";

const TONES: Record<PillTone, string> = {
  success: "bg-status-success-soft text-status-success",
  warning: "bg-status-warning-soft text-status-warning",
  danger: "bg-status-danger-soft text-status-danger",
  neutral: "bg-status-neutral-soft text-status-neutral",
  accent: "bg-accent-soft text-accent-text",
};

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  icon?: React.ReactNode;
}

/**
 * Compact rounded label. `StatusPill` is the same component — the audit's
 * severity language (DRC/ERC/BOM/cloud) all route through these tones so a
 * given color carries one meaning everywhere in the app.
 */
export const Pill = React.forwardRef<HTMLSpanElement, PillProps>(
  ({ tone = "neutral", icon, className, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-medium",
        TONES[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  ),
);
Pill.displayName = "Pill";

export const StatusPill = Pill;
