import * as React from "react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "./focus";

export type StatusBarProps = React.HTMLAttributes<HTMLDivElement>;

/** 22px bottom status bar (design D2 §9). */
export const StatusBar = React.forwardRef<HTMLDivElement, StatusBarProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex h-[22px] shrink-0 items-center overflow-hidden border-t border-border bg-surface-rail",
        "font-mono text-2xs text-text-secondary",
        className,
      )}
      {...props}
    />
  ),
);
StatusBar.displayName = "StatusBar";

export interface StatusSegmentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Grow to fill the bar and truncate (used for the hint segment). */
  flex?: boolean;
  /** Render in the sans face instead of mono (prose segments). */
  sans?: boolean;
  /** Force the mono face (default; kept for symmetry with `sans`). */
  mono?: boolean;
  /** When provided the segment renders as a `<button>`. */
  onClick?: React.MouseEventHandler<HTMLElement>;
}

/** One status-bar cell. Separated from its neighbour by a right border. */
export const StatusSegment = React.forwardRef<HTMLElement, StatusSegmentProps>(
  ({ flex = false, sans = false, mono = false, onClick, className, children, ...props }, ref) => {
    const classes = cn(
      "flex h-full items-center gap-2 border-r border-border px-[10px] last:border-r-0",
      flex && "min-w-0 flex-1 truncate",
      sans && "font-sans",
      mono && "font-mono",
      onClick && "transition-colors hover:bg-surface-hover hover:text-text-strong",
      className,
    );
    if (onClick) {
      return (
        <button
          ref={ref as React.Ref<HTMLButtonElement>}
          type="button"
          onClick={onClick}
          className={cn(classes, FOCUS_RING)}
          {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        >
          {children}
        </button>
      );
    }
    return (
      <div
        ref={ref as React.Ref<HTMLDivElement>}
        className={classes}
        {...props}
      >
        {children}
      </div>
    );
  },
);
StatusSegment.displayName = "StatusSegment";
