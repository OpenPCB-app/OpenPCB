import * as React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Adds hover border/shadow affordance (for clickable cards). */
  interactive?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ interactive = false, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-card border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900",
        interactive &&
          "group relative transition-[border-color,box-shadow] duration-75 hover:border-violet-500 hover:shadow-md dark:hover:border-violet-500",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";
