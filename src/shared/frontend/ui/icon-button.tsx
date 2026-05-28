import * as React from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./tooltip";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible label; also shown as a tooltip when provided. */
  label: string;
  size?: "sm" | "md";
}

/** Square icon-only button with an attached tooltip + aria-label. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, size = "md", className, children, ...props }, ref) => {
    const button = (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={cn(
          "inline-flex items-center justify-center rounded-control text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
          size === "sm" ? "h-7 w-7" : "h-8 w-8",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
    return <Tooltip label={label}>{button}</Tooltip>;
  },
);
IconButton.displayName = "IconButton";
