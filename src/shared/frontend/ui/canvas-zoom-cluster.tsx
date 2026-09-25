import * as React from "react";
import { Plus, Minus, Maximize } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "./focus";

export interface CanvasZoomClusterProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  className?: string;
}

const buttonClassName = cn(
  "flex h-[22px] w-[22px] items-center justify-center hover:bg-surface-hover hover:text-text-strong cursor-pointer",
  FOCUS_RING,
);

/** Floating zoom-in / zoom-out / zoom-to-fit cluster, docked to a canvas corner. */
export function CanvasZoomCluster({
  onZoomIn,
  onZoomOut,
  onFit,
  className,
}: CanvasZoomClusterProps) {
  return (
    <div
      className={cn(
        "absolute right-2 top-2 z-10 flex flex-col gap-0.5 border border-border bg-surface-panel/95 p-0.5 text-text-secondary",
        className,
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in"
        onClick={onZoomIn}
        className={buttonClassName}
      >
        <Plus className="h-3 w-3" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out"
        onClick={onZoomOut}
        className={buttonClassName}
      >
        <Minus className="h-3 w-3" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label="Zoom to fit"
        title="Zoom to fit"
        onClick={onFit}
        className={buttonClassName}
      >
        <Maximize className="h-3 w-3" strokeWidth={1.5} />
      </button>
    </div>
  );
}
