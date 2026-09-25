import * as React from "react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "./focus";
import { Tooltip } from "./tooltip";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible label; also shown as a tooltip when provided. */
  label: string;
  size?: "sm" | "md";
  /** `outline` (default) draws the 1px control border; `ghost` is borderless. */
  variant?: "outline" | "ghost";
  /** Renders the pressed/active look (and `aria-pressed`). */
  active?: boolean;
  /** Set false to skip the tooltip wrapper (the aria-label is still applied). */
  tooltip?: boolean;
}

/** Square icon-only button with an attached tooltip + aria-label. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      label,
      size = "md",
      variant = "outline",
      active,
      tooltip = true,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const button = (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={typeof active === "boolean" ? active : undefined}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-control transition-colors",
          FOCUS_RING,
          "disabled:cursor-not-allowed disabled:opacity-50",
          "[&_svg]:h-[12px] [&_svg]:w-[12px] [&_svg]:shrink-0",
          variant === "outline" && "border border-border-control",
          active
            ? "bg-surface-control text-text-strong"
            : "text-text-secondary hover:bg-surface-hover hover:text-text-strong",
          size === "sm" ? "h-5 w-5" : "h-[22px] w-[22px]",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
    if (!tooltip) return button;
    return <Tooltip label={label}>{button}</Tooltip>;
  },
);
IconButton.displayName = "IconButton";
