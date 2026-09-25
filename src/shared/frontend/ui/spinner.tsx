import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type SpinnerSize = "sm" | "md" | "lg";

const SIZES: Record<SpinnerSize, string> = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
  lg: "h-4 w-4",
};

function SpinnerGlyph({ size, className }: { size: SpinnerSize; className?: string }) {
  return (
    <Loader2
      aria-hidden="true"
      strokeWidth={1.5}
      className={cn(
        "shrink-0 animate-spin motion-reduce:animate-none",
        SIZES[size],
        className,
      )}
    />
  );
}

export interface SpinnerProps {
  /** `sm` 12px, `md` 14px (default), `lg` 16px. */
  size?: SpinnerSize;
  /** Accessible name (visually hidden). Default "Loading". */
  label?: string;
  className?: string;
}

/** Standalone busy indicator (`role="status"`; static when reduced motion). */
export function Spinner({ size = "md", label = "Loading", className }: SpinnerProps) {
  return (
    <span role="status" className={cn("inline-flex text-text-tertiary", className)}>
      <SpinnerGlyph size={size} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export interface LoadingStateProps {
  /** Visible text. Default "Loading…". */
  label?: string;
  /** Inline row (in a toolbar/list) instead of a centred block. */
  inline?: boolean;
  /** Drawn over an always-dark canvas well. */
  well?: boolean;
  className?: string;
}

/** Spinner + text; the block form centres itself in its container. */
export function LoadingState({
  label = "Loading…",
  inline = false,
  well = false,
  className,
}: LoadingStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "items-center gap-1.5 text-xs",
        inline ? "inline-flex" : "flex h-full min-h-[64px] w-full justify-center",
        well ? "text-well-text" : "text-text-secondary",
        className,
      )}
    >
      <SpinnerGlyph size="md" className={well ? "text-well-text-muted" : "text-text-tertiary"} />
      <span>{label}</span>
    </div>
  );
}
