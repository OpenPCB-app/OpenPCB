import * as React from "react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "./focus";

export type ToolbarProps = React.HTMLAttributes<HTMLDivElement>;

/** 30px docked editor toolbar (design D2 §4). */
export const Toolbar = React.forwardRef<HTMLDivElement, ToolbarProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex h-[30px] shrink-0 items-center gap-0.5 border-b border-border bg-surface-panel px-1.5 text-text-secondary",
        className,
      )}
      {...props}
    />
  ),
);
Toolbar.displayName = "Toolbar";

export interface ToolbarButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  icon?: React.ReactNode;
  /**
   * Tooltip text. Defaults to the accessible name; pass a longer string (e.g.
   * with a modifier hotkey) without changing `aria-label`.
   */
  title?: string;
  /**
   * Accessible name. With `hotkey` the button's `title` and `aria-label` become
   * exactly `${label} (${hotkey})` — e2e locators depend on these strings.
   */
  label: string;
  hotkey?: string;
  active?: boolean;
  /** Emit `aria-pressed` from `active` (for toggle-style tools). */
  pressable?: boolean;
  /** Optional visible text; makes the button auto-width instead of 24×24. */
  children?: React.ReactNode;
}

/** 24×24 icon tool (or auto-width text tool when `children` is given). */
export const ToolbarButton = React.forwardRef<
  HTMLButtonElement,
  ToolbarButtonProps
>(
  (
    { icon, label, hotkey, title, active = false, pressable = false, className, children, ...props },
    ref,
  ) => {
    const name = hotkey ? `${label} (${hotkey})` : label;
    const tooltip = title ?? name;
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-control transition-colors",
          FOCUS_RING,
          "disabled:cursor-not-allowed disabled:opacity-35",
          "[&_svg]:h-[14px] [&_svg]:w-[14px] [&_svg]:shrink-0 [&_svg]:[stroke-width:1.5]",
          children !== undefined && children !== null
            ? "h-6 gap-1.5 px-2 text-xs"
            : "h-6 w-6",
          active
            ? "bg-surface-control text-text-strong"
            : "hover:bg-surface-hover hover:text-text-strong",
          className,
        )}
        {...props}
        aria-pressed={pressable ? active : undefined}
        title={tooltip}
        aria-label={name}
      >
        {icon}
        {children}
      </button>
    );
  },
);
ToolbarButton.displayName = "ToolbarButton";

/** 1×16 vertical rule between tool groups. */
export function ToolbarSeparator({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("mx-1 h-4 w-px shrink-0 bg-divider", className)}
    />
  );
}

/** Pushes the remaining toolbar items to the right edge. */
export function ToolbarSpacer({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("flex-1", className)} />;
}
