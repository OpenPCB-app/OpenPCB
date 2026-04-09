/**
 * IPC-7351 Density Level Selector
 *
 * 3-option segmented control for Most (M) / Nominal (N) / Least (L) density.
 */

import { cn } from "@/lib/utils";
import type { DensityLevel } from "@/lib/ipc-7351/types";
import { COURTYARD_EXCESS } from "@/lib/ipc-7351/fillet-tables";

interface DensitySelectorProps {
  value: DensityLevel;
  onChange: (density: DensityLevel) => void;
  disabled?: boolean;
}

const DENSITY_OPTIONS: Array<{
  level: DensityLevel;
  letter: string;
  label: string;
  description: string;
}> = [
  {
    level: "most",
    letter: "M",
    label: "Most",
    description: `Largest pads, ${COURTYARD_EXCESS.most}mm courtyard`,
  },
  {
    level: "nominal",
    letter: "N",
    label: "Nominal",
    description: `Standard pads, ${COURTYARD_EXCESS.nominal}mm courtyard`,
  },
  {
    level: "least",
    letter: "L",
    label: "Least",
    description: `Smallest pads, ${COURTYARD_EXCESS.least}mm courtyard`,
  },
];

export function DensitySelector({
  value,
  onChange,
  disabled,
}: DensitySelectorProps) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-text-secondary">
        IPC Density Level
      </label>
      <div className="flex rounded-md border border-border-default overflow-hidden">
        {DENSITY_OPTIONS.map((opt) => (
          <button
            key={opt.level}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.level)}
            className={cn(
              "flex-1 px-2 py-1.5 text-center transition-colors text-xs",
              "focus:outline-none focus:ring-1 focus:ring-brand focus:ring-inset",
              value === opt.level
                ? "bg-brand/15 text-brand font-medium border-brand"
                : "bg-bg-elevated text-text-secondary hover:bg-bg-secondary",
              opt.level !== "most" && "border-l border-border-default",
            )}
            title={opt.description}
          >
            <span className="font-mono font-bold">{opt.letter}</span>
            <span className="ml-1 text-[10px]">{opt.label}</span>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-text-muted">
        {DENSITY_OPTIONS.find((o) => o.level === value)?.description}
      </p>
    </div>
  );
}
