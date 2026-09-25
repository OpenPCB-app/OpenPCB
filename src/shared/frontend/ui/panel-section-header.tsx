import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "./focus";

export interface PanelSectionHeaderProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  /** Right-aligned count badge (mono). */
  count?: number | string;
  /** Extra controls rendered after the count. */
  trailing?: React.ReactNode;
  /** When defined together with `onToggle`, renders a chevron affordance. */
  collapsed?: boolean;
  onToggle?: () => void;
  /**
   * `default` = 24px panel section header.
   * `uppercase` = 22px 10px-uppercase property-section header.
   */
  variant?: "default" | "uppercase";
}

/**
 * Docked panel section header (design D2 §6) and, via `variant="uppercase"`,
 * the property-grid section header (design D2 §7).
 */
export const PanelSectionHeader = React.forwardRef<
  HTMLDivElement,
  PanelSectionHeaderProps
>(
  (
    {
      title,
      count,
      trailing,
      collapsed,
      onToggle,
      variant = "default",
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const uppercase = variant === "uppercase";
    const titleNode = (
      <span
        className={cn(
          "min-w-0 truncate",
          uppercase
            ? "text-2xs uppercase tracking-[.04em] text-text-tertiary"
            : "text-xs font-medium text-text-strong",
        )}
      >
        {title}
      </span>
    );
    const chevron = onToggle ? (
      <ChevronDown
        aria-hidden="true"
        className={cn(
          "h-3 w-3 shrink-0 text-text-tertiary transition-transform",
          collapsed && "-rotate-90",
        )}
      />
    ) : null;

    return (
      <div
        ref={ref}
        className={cn(
          "flex shrink-0 items-center gap-1.5 border-y border-border bg-surface-section px-2",
          uppercase ? "h-[22px]" : "h-[24px]",
          className,
        )}
        {...props}
      >
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={collapsed === undefined ? undefined : !collapsed}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left",
              FOCUS_RING,
            )}
          >
            {chevron}
            {titleNode}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">{titleNode}</div>
        )}
        {count !== undefined && count !== null ? (
          <span className="shrink-0 font-mono text-2xs tabular-nums text-text-tertiary">
            {count}
          </span>
        ) : null}
        {trailing ? (
          <div className="flex shrink-0 items-center gap-1">{trailing}</div>
        ) : null}
        {children}
      </div>
    );
  },
);
PanelSectionHeader.displayName = "PanelSectionHeader";
