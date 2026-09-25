import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** A lucide icon element; sized by the component. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** What to do next — for a filter miss, say what to clear. */
  description?: React.ReactNode;
  /** Buttons (kit `Button`), e.g. a primary action or "Clear search". */
  actions?: React.ReactNode;
  /** `md` (default): 12px title / 11px text; `sm` (panels): 11px / 10px. */
  size?: "sm" | "md";
  align?: "center" | "start";
  /** Element for the title — keep a heading where one is expected. */
  titleAs?: "p" | "h1" | "h2" | "h3" | "h4";
  /** Drawn over an always-dark canvas well (theme-invariant well tokens). */
  well?: boolean;
}

/** The ONE empty-state pattern (T-022): icon, title, hint, optional actions. */
export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  (
    {
      icon,
      title,
      description,
      actions,
      size = "md",
      align = "center",
      titleAs: Title = "p",
      well = false,
      className,
      ...props
    },
    ref,
  ) => {
    const small = size === "sm";
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col",
          align === "center" ? "items-center text-center" : "items-start text-left",
          small ? "gap-1 px-3 py-4" : "gap-1.5 px-4 py-8",
          className,
        )}
        {...props}
      >
        {icon ? (
          <span
            aria-hidden="true"
            className={cn(
              "mb-1 flex items-center",
              small ? "[&_svg]:h-4 [&_svg]:w-4" : "[&_svg]:h-6 [&_svg]:w-6",
              well ? "text-well-text-muted" : "text-text-tertiary",
            )}
          >
            {icon}
          </span>
        ) : null}
        <Title
          className={cn(
            "m-0 font-medium",
            small ? "text-xs" : "text-sm",
            well ? "text-well-text" : "text-text-strong",
          )}
        >
          {title}
        </Title>
        {description ? (
          <div
            className={cn(
              "max-w-[360px]",
              small ? "text-2xs" : "text-xs",
              well ? "text-well-text-muted" : "text-text-secondary",
            )}
          >
            {description}
          </div>
        ) : null}
        {actions ? (
          <div className={cn("flex flex-wrap items-center gap-2", small ? "mt-1.5" : "mt-3")}>
            {actions}
          </div>
        ) : null}
      </div>
    );
  },
);
EmptyState.displayName = "EmptyState";
