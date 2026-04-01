/**
 * Body Preset Selector
 *
 * Component for selecting symbol body presets.
 */

import { useCallback } from "react";
import { useSymbolEditorStore } from "./symbol-editor-store";
import type { BodyPresetKind } from "./types";

// ---------------------------------------------------------------------------
// Preset Definitions
// ---------------------------------------------------------------------------

interface BodyPresetOption {
  kind: BodyPresetKind;
  label: string;
  description: string;
  icon: string;
}

const BODY_PRESETS: BodyPresetOption[] = [
  {
    kind: "blank",
    label: "Blank",
    description: "Empty canvas for custom symbols",
    icon: "□",
  },
  {
    kind: "ic_box",
    label: "IC Box",
    description: "Rectangular IC package",
    icon: "▭",
  },
  {
    kind: "opamp",
    label: "Op-Amp",
    description: "Triangle operational amplifier",
    icon: "▷",
  },
  {
    kind: "two_pin_passive",
    label: "2-Pin Passive",
    description: "Resistor, capacitor, etc.",
    icon: "═",
  },
  {
    kind: "transistor",
    label: "Transistor",
    description: "BJT or MOSFET 3-terminal",
    icon: "◯",
  },
  {
    kind: "diode",
    label: "Diode",
    description: "Triangle + bar diode symbol",
    icon: "◁|",
  },
  {
    kind: "connector",
    label: "Connector",
    description: "Dashed rectangle for connectors",
    icon: "⊞",
  },
  {
    kind: "voltage_regulator",
    label: "V-Reg",
    description: "3-pin voltage regulator",
    icon: "▥",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BodyPresetSelector() {
  const currentPreset = useSymbolEditorStore((s) => s.draft.body.kind);
  const setBodyPreset = useSymbolEditorStore((s) => s.setBodyPreset);

  const handleSelect = useCallback(
    (kind: BodyPresetKind) => {
      setBodyPreset(kind);
    },
    [setBodyPreset],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium text-muted-foreground">
        Body Shape
      </div>
      <div className="grid grid-cols-2 gap-2">
        {BODY_PRESETS.map((preset) => (
          <button
            key={preset.kind}
            onClick={() => handleSelect(preset.kind)}
            className={`flex flex-col items-center gap-1 rounded-md border p-3 text-center transition-colors ${
              currentPreset === preset.kind
                ? "border-primary bg-primary/10"
                : "border-border bg-card hover:border-primary/50"
            }`}
            title={preset.description}
          >
            <span className="text-2xl">{preset.icon}</span>
            <span className="text-xs">{preset.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { BODY_PRESETS };
export type { BodyPresetOption };
