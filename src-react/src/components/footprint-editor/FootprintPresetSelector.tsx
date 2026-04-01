/**
 * FootprintPresetSelector Component
 *
 * Displays a categorized grid of footprint preset options.
 */

import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { useFootprintEditorStore } from "./footprint-editor-store";
import { generateFromPreset, DEFAULT_PRESET_CONFIGS } from "./preset-utils";
import type { FootprintPresetKind } from "./types";

interface PresetOption {
  kind: FootprintPresetKind;
  label: string;
  description: string;
}

interface PresetCategory {
  label: string;
  presets: PresetOption[];
}

const PRESET_CATEGORIES: PresetCategory[] = [
  {
    label: "2-Terminal",
    presets: [
      {
        kind: "chip_2terminal",
        label: "Chip",
        description: "R, C, L (0402-2512)",
      },
      { kind: "sod", label: "SOD", description: "Small Outline Diode" },
      {
        kind: "melf",
        label: "MELF",
        description: "Cylindrical (metal electrode)",
      },
      {
        kind: "polarized_cap",
        label: "Polar Cap",
        description: "Tantalum, electrolytic",
      },
    ],
  },
  {
    label: "Dual-Row",
    presets: [
      {
        kind: "soic",
        label: "SOIC",
        description: "Small Outline IC (8-28 pins)",
      },
      { kind: "sot", label: "SOT", description: "Small Outline Transistor" },
      { kind: "soj", label: "SOJ", description: "J-Lead dual-row" },
      { kind: "dip", label: "DIP", description: "Through-hole dual in-line" },
    ],
  },
  {
    label: "Quad",
    presets: [
      { kind: "qfp", label: "QFP", description: "Quad Flat Package" },
      { kind: "qfn", label: "QFN", description: "Quad Flat No-lead" },
      { kind: "plcc", label: "PLCC", description: "J-Lead chip carrier" },
    ],
  },
  {
    label: "Array & Power",
    presets: [
      { kind: "bga", label: "BGA", description: "Ball Grid Array" },
      { kind: "dpak", label: "DPAK", description: "D-PAK / TO-252 power" },
    ],
  },
  {
    label: "Other",
    presets: [
      { kind: "import", label: "Import", description: "From .kicad_mod file" },
    ],
  },
];

interface FootprintPresetSelectorProps {
  onSelect?: (kind: FootprintPresetKind) => void;
}

export function FootprintPresetSelector({
  onSelect,
}: FootprintPresetSelectorProps) {
  const currentPreset = useFootprintEditorStore((s) => s.draft.preset);
  const setPreset = useFootprintEditorStore((s) => s.setPreset);
  const setPads = useFootprintEditorStore((s) => s.setPads);
  const setGraphics = useFootprintEditorStore((s) => s.setGraphics);

  const handleSelect = useCallback(
    (kind: FootprintPresetKind) => {
      const config = DEFAULT_PRESET_CONFIGS[kind];
      setPreset(kind, config);

      if (kind !== "import") {
        const { pads, graphics } = generateFromPreset(kind, config);
        setPads(pads);
        setGraphics(graphics);
      }

      onSelect?.(kind);
    },
    [setPreset, setPads, setGraphics, onSelect],
  );

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-text-primary">Package Type</h3>
      {PRESET_CATEGORIES.map((category) => (
        <div key={category.label}>
          <div className="mb-1.5 px-0.5">
            <span className="text-[9px] font-semibold tracking-widest text-text-muted uppercase">
              {category.label}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {category.presets.map((preset) => (
              <button
                key={preset.kind}
                onClick={() => handleSelect(preset.kind)}
                className={cn(
                  "group relative flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 transition-all text-left",
                  "border-border-default bg-bg-elevated hover:border-brand hover:bg-bg-secondary",
                  "focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1",
                  currentPreset === preset.kind &&
                    "border-brand bg-bg-secondary ring-1 ring-brand/30",
                )}
              >
                <div className="text-xs font-medium text-text-primary">
                  {preset.label}
                </div>
                <div className="text-[10px] text-text-muted leading-tight">
                  {preset.description}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
