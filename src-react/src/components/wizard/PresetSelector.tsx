/**
 * PresetSelector Component
 *
 * First step in the Component Creation Wizard.
 * Displays a grid of body preset options for the user to select.
 */

import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { useComponentWizardStore } from "@/stores/component-wizard-store";
import type { BodyPresetKind } from "../symbol-editor/types";

// ---------------------------------------------------------------------------
// Preset Definitions
// ---------------------------------------------------------------------------

interface PresetOption {
  kind: BodyPresetKind;
  label: string;
  description: string;
  icon: string;
  preview: React.ReactNode;
}

const PRESET_OPTIONS: PresetOption[] = [
  {
    kind: "ic_box",
    label: "IC Box",
    description: "Rectangular IC package with configurable pins",
    icon: "▭",
    preview: (
      <svg
        viewBox="0 0 64 64"
        className="h-16 w-16 text-text-secondary"
        fill="none"
      >
        <rect
          x="16"
          y="12"
          width="32"
          height="40"
          stroke="currentColor"
          strokeWidth="2"
          rx="2"
        />
        <line x1="8" y1="20" x2="16" y2="20" stroke="currentColor" strokeWidth="2" />
        <line x1="8" y1="28" x2="16" y2="28" stroke="currentColor" strokeWidth="2" />
        <line x1="8" y1="36" x2="16" y2="36" stroke="currentColor" strokeWidth="2" />
        <line x1="48" y1="20" x2="56" y2="20" stroke="currentColor" strokeWidth="2" />
        <line x1="48" y1="28" x2="56" y2="28" stroke="currentColor" strokeWidth="2" />
        <line x1="48" y1="36" x2="56" y2="36" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
  },
  {
    kind: "opamp",
    label: "Op-Amp",
    description: "Triangle operational amplifier symbol",
    icon: "▷",
    preview: (
      <svg
        viewBox="0 0 64 64"
        className="h-16 w-16 text-text-secondary"
        fill="none"
      >
        <path
          d="M16 12 L48 32 L16 52 Z"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
        />
        <line x1="8" y1="22" x2="16" y2="22" stroke="currentColor" strokeWidth="2" />
        <line x1="8" y1="42" x2="16" y2="42" stroke="currentColor" strokeWidth="2" />
        <line x1="48" y1="32" x2="56" y2="32" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
  },
  {
    kind: "two_pin_passive",
    label: "Two-Pin Passive",
    description: "Resistor, capacitor, or other 2-terminal component",
    icon: "═",
    preview: (
      <svg
        viewBox="0 0 64 64"
        className="h-16 w-16 text-text-secondary"
        fill="none"
      >
        <line x1="8" y1="32" x2="18" y2="32" stroke="currentColor" strokeWidth="2" />
        <path
          d="M18 32 L24 24 L30 40 L36 24 L42 40 L46 32"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
        />
        <line x1="46" y1="32" x2="56" y2="32" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
  },
  {
    kind: "blank",
    label: "Blank Canvas",
    description: "Start from scratch with custom shapes",
    icon: "□",
    preview: (
      <svg
        viewBox="0 0 64 64"
        className="h-16 w-16 text-text-tertiary"
        fill="none"
      >
        <rect
          x="16"
          y="16"
          width="32"
          height="32"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="4 4"
          rx="2"
        />
      </svg>
    ),
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PresetSelectorProps {
  onSelect: (preset: BodyPresetKind) => void;
}

export function PresetSelector({ onSelect }: PresetSelectorProps) {
  const updateDraft = useComponentWizardStore((s) => s.updateDraft);

  const handleSelect = useCallback(
    (kind: BodyPresetKind) => {
      // Update draft with selected preset - store body kind for symbol editor
      updateDraft({
        symbolData: {
          body: { kind, width: 0, height: 0 }, // Dimensions set by symbol editor
        },
      });

      // Notify parent
      onSelect(kind);
    },
    [updateDraft, onSelect],
  );

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-semibold text-text-primary mb-2">
            Choose a body shape
          </h2>
          <p className="text-sm text-text-muted">
            Select a preset to get started. You can customize it in the next step.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {PRESET_OPTIONS.map((preset) => (
            <button
              key={preset.kind}
              onClick={() => handleSelect(preset.kind)}
              className={cn(
                "group relative flex flex-col items-center gap-4 rounded-lg border-2 p-6 transition-all",
                "border-border-default bg-bg-elevated hover:border-brand hover:bg-bg-secondary",
                "focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2",
              )}
            >
              {/* Preview */}
              <div className="flex h-24 w-24 items-center justify-center rounded-md bg-bg-input group-hover:bg-bg-primary transition-colors">
                {preset.preview}
              </div>

              {/* Label */}
              <div className="text-center">
                <h3 className="text-base font-medium text-text-primary mb-1">
                  {preset.label}
                </h3>
                <p className="text-xs text-text-muted">
                  {preset.description}
                </p>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-8 text-center">
          <p className="text-xs text-text-tertiary">
            Not sure which to pick? Start with <strong>IC Box</strong> for multi-pin
            components or <strong>Two-Pin Passive</strong> for simple parts.
          </p>
        </div>
      </div>
    </div>
  );
}
