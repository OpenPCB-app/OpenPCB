import * as React from "react";
import { cn } from "@/lib/utils";

export type SeverityLevel = "error" | "warning" | "info";

const SEVERITIES: Record<SeverityLevel, string> = {
  error: "bg-drc-error",
  warning: "bg-drc-warning",
  info: "bg-drc-info",
};

export interface SeverityDiamondProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  severity: SeverityLevel;
  /** Native tooltip; also becomes the accessible name when present. */
  title?: string;
}

/** 7×7 rotated square used as the DRC/ERC severity marker (design D2 §7). */
export const SeverityDiamond = React.forwardRef<
  HTMLSpanElement,
  SeverityDiamondProps
>(({ severity, title, className, ...props }, ref) => (
  <span
    ref={ref}
    title={title}
    role={title ? "img" : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : "true"}
    className={cn(
      "inline-block h-[7px] w-[7px] shrink-0 rotate-45",
      SEVERITIES[severity],
      className,
    )}
    {...props}
  />
));
SeverityDiamond.displayName = "SeverityDiamond";
