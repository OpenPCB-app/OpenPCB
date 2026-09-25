import * as React from "react";
import { cn } from "@/lib/utils";
import { FOCUS_RING_OUTSET } from "./focus";

/**
 * `outline` is an alias of `secondary` and `destructive` an alias of `danger`
 * (kept so both naming conventions in the codebase compile).
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "destructive";

/** `md` is the historical name of the 22px default size. */
export type ButtonSize = "sm" | "md" | "default" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground font-medium hover:opacity-90",
  secondary:
    "border border-border-control bg-transparent text-text hover:bg-surface-hover hover:text-text-strong",
  outline:
    "border border-border-control bg-transparent text-text hover:bg-surface-hover hover:text-text-strong",
  ghost:
    "bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-strong",
  danger:
    "bg-status-danger text-primary-foreground font-medium hover:opacity-90",
  destructive:
    "bg-status-danger text-primary-foreground font-medium hover:opacity-90",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-5 gap-1 px-2 text-xs",
  md: "h-[22px] gap-1.5 px-[10px] text-xs",
  default: "h-[22px] gap-1.5 px-[10px] text-xs",
  lg: "h-7 gap-2 px-3 text-sm",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "secondary", size = "md", icon, className, children, ...props },
    ref,
  ) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-control transition-colors",
        FOCUS_RING_OUTSET,
        "disabled:cursor-not-allowed disabled:opacity-50",
        "[&_svg]:shrink-0",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
