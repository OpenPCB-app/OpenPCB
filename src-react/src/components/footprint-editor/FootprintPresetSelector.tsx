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
  const isImportedPresetLocked = useFootprintEditorStore((s) => s.isImportedPresetLocked);
  const setPreset = useFootprintEditorStore((s) => s.setPreset);
  const setPads = useFootprintEditorStore((s) => s.setPads);
  const setGraphics = useFootprintEditorStore((s) => s.setGraphics);
  const unlockImportedPreset = useFootprintEditorStore((s) => s.unlockImportedPreset);

  const handleSelect = useCallback(
    (kind: FootprintPresetKind) => {
      if (isImportedPresetLocked) {
        return;
      }

      const config = DEFAULT_PRESET_CONFIGS[kind];
      setPreset(kind, config);

      if (kind !== "import") {
        const { pads, graphics } = generateFromPreset(kind, config);
        setPads(pads);
        setGraphics(graphics);
      }

      onSelect?.(kind);
    },
    [isImportedPresetLocked, setPreset, setPads, setGraphics, onSelect],
  );

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-text-primary">Package Type</h3>
      {isImportedPresetLocked && (
        <div className="rounded-md border border-border-default bg-bg-input p-2 text-xs text-text-secondary">
          <p>Imported footprint locked. Replace to choose a preset.</p>
          <button
            type="button"
            onClick={unlockImportedPreset}
            className="mt-2 rounded bg-bg-elevated px-2 py-1 text-xs font-medium text-text-primary hover:bg-bg-secondary"
          >
            Replace imported footprint
          </button>
        </div>
      )}
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
                type="button"
                onClick={() => handleSelect(preset.kind)}
                disabled={isImportedPresetLocked}
                className={cn(
                  "group relative flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 transition-all text-left",
                  "border-border-default bg-bg-elevated hover:border-brand hover:bg-bg-secondary",
                  "focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1",
                  isImportedPresetLocked && "cursor-not-allowed opacity-50 hover:border-border-default hover:bg-bg-elevated",
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
