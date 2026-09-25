import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "outline";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-status-neutral-soft text-status-neutral",
  info: "bg-status-info-soft text-status-info",
  success: "bg-status-success-soft text-status-success",
  warning: "bg-status-warning-soft text-status-warning",
  danger: "bg-status-danger-soft text-status-danger",
  outline: "border border-border-control text-text-secondary",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: React.ReactNode;
  /** Uppercase micro-label (source/kind tags such as CORE / USER). */
  caps?: boolean;
  mono?: boolean;
}

/**
 * Static square label (2px radius) on status tokens — the one badge for
 * non-status tags and state words ("core", "read-only", "Up to date",
 * "Caution"). `Pill` stays for status-with-dot; `Chip` is a toggle button.
 */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ tone = "neutral", icon, caps = false, mono = false, className, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex h-4 shrink-0 items-center gap-1 whitespace-nowrap rounded-control px-1 text-2xs font-medium",
        "[&_svg]:h-2.5 [&_svg]:w-2.5 [&_svg]:shrink-0",
        caps && "uppercase tracking-[.04em]",
        mono && "font-mono",
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
Badge.displayName = "Badge";
