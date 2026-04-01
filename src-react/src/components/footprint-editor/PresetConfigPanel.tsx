/**
 * PresetConfigPanel Component
 *
 * Form fields for configuring footprint preset parameters.
 */

import { useCallback } from "react";
import { useFootprintEditorStore } from "./footprint-editor-store";
import { generateFromPreset } from "./preset-utils";
import { DensitySelector } from "./DensitySelector";
import type {
  PresetConfig,
  Chip2TerminalConfig,
  SoicConfig,
  QfpConfig,
  QfnConfig,
  BgaConfig,
  DipConfig,
} from "./types";

interface NumberInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}

function NumberInput({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  step = 0.01,
  disabled,
}: NumberInputProps) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-text-secondary">
        {label}
        {unit && <span className="text-text-tertiary ml-1">({unit})</span>}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className="w-full h-8 rounded-md bg-bg-input px-2 text-sm text-text-primary border border-border-default focus:border-border-strong focus:outline-none disabled:opacity-50"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preset-Specific Config Panels
// ---------------------------------------------------------------------------

function Chip2TerminalConfigPanel({ config }: { config: Chip2TerminalConfig }) {
  const updateConfig = useFootprintEditorStore((s) => s.updateConfig);
  const setPads = useFootprintEditorStore((s) => s.setPads);
  const setGraphics = useFootprintEditorStore((s) => s.setGraphics);

  const handleChange = useCallback(
    (updates: Partial<Chip2TerminalConfig>) => {
      const newConfig = { ...config, ...updates } as PresetConfig;
      updateConfig(newConfig);
      const { pads, graphics } = generateFromPreset(
        "chip_2terminal",
        newConfig,
      );
      setPads(pads);
      setGraphics(graphics);
    },
    [config, updateConfig, setPads, setGraphics],
  );

  return (
    <div className="space-y-3">
      <NumberInput
        label="Pad Width"
        value={config.padWidth}
        onChange={(v) => handleChange({ padWidth: v })}
        unit="mm"
        min={0.1}
        max={5}
      />
      <NumberInput
        label="Pad Height"
        value={config.padHeight}
        onChange={(v) => handleChange({ padHeight: v })}
        unit="mm"
        min={0.1}
        max={5}
      />
      <NumberInput
        label="Pad Spacing"
        value={config.padSpacing}
        onChange={(v) => handleChange({ padSpacing: v })}
        unit="mm"
        min={0.2}
        max={20}
      />
      <NumberInput
        label="Body Width"
        value={config.bodyWidth}
        onChange={(v) => handleChange({ bodyWidth: v })}
        unit="mm"
        min={0.1}
        max={20}
      />
      <NumberInput
        label="Body Height"
        value={config.bodyHeight}
        onChange={(v) => handleChange({ bodyHeight: v })}
        unit="mm"
        min={0.1}
        max={10}
      />
    </div>
  );
}

function SoicConfigPanel({ config }: { config: SoicConfig }) {
  const updateConfig = useFootprintEditorStore((s) => s.updateConfig);
  const setPads = useFootprintEditorStore((s) => s.setPads);
  const setGraphics = useFootprintEditorStore((s) => s.setGraphics);

  const handleChange = useCallback(
    (updates: Partial<SoicConfig>) => {
      const newConfig = { ...config, ...updates } as PresetConfig;
      updateConfig(newConfig);
      const { pads, graphics } = generateFromPreset("soic", newConfig);
      setPads(pads);
      setGraphics(graphics);
    },
    [config, updateConfig, setPads, setGraphics],
  );

  return (
    <div className="space-y-3">
      <NumberInput
        label="Pin Count"
        value={config.pinCount}
        onChange={(v) =>
          handleChange({ pinCount: Math.max(4, Math.round(v / 2) * 2) })
        }
        unit=""
        min={4}
        max={28}
        step={2}
      />
      <NumberInput
        label="Pitch"
        value={config.pitch}
        onChange={(v) => handleChange({ pitch: v })}
        unit="mm"
        min={0.4}
        max={2.54}
      />
      <NumberInput
        label="Pad Width"
        value={config.padWidth}
        onChange={(v) => handleChange({ padWidth: v })}
        unit="mm"
        min={0.2}
        max={3}
      />
      <NumberInput
        label="Pad Height"
        value={config.padHeight}
        onChange={(v) => handleChange({ padHeight: v })}
        unit="mm"
        min={0.5}
        max={3}
      />
      <NumberInput
        label="Row Spacing"
        value={config.rowSpacing}
        onChange={(v) => handleChange({ rowSpacing: v })}
        unit="mm"
        min={2}
        max={20}
      />
    </div>
  );
}

function QfpConfigPanel({ config }: { config: QfpConfig }) {
  const updateConfig = useFootprintEditorStore((s) => s.updateConfig);
  const setPads = useFootprintEditorStore((s) => s.setPads);
  const setGraphics = useFootprintEditorStore((s) => s.setGraphics);

  const handleChange = useCallback(
    (updates: Partial<QfpConfig>) => {
      const newConfig = { ...config, ...updates } as PresetConfig;
      updateConfig(newConfig);
      const { pads, graphics } = generateFromPreset("qfp", newConfig);
      setPads(pads);
      setGraphics(graphics);
    },
    [config, updateConfig, setPads, setGraphics],
  );

  return (
    <div className="space-y-3">
      <NumberInput
        label="Pins Per Side"
        value={config.pinsPerSide}
        onChange={(v) =>
          handleChange({ pinsPerSide: Math.max(4, Math.round(v)) })
        }
        unit=""
        min={4}
        max={80}
      />
      <NumberInput
        label="Pitch"
        value={config.pitch}
        onChange={(v) => handleChange({ pitch: v })}
        unit="mm"
        min={0.3}
        max={1.27}
      />
      <NumberInput
        label="Pad Width"
        value={config.padWidth}
        onChange={(v) => handleChange({ padWidth: v })}
        unit="mm"
        min={0.1}
        max={1}
      />
      <NumberInput
        label="Pad Height"
        value={config.padHeight}
        onChange={(v) => handleChange({ padHeight: v })}
        unit="mm"
        min={0.5}
        max={3}
      />
      <NumberInput
        label="Body Width"
        value={config.bodyWidth}
        onChange={(v) => handleChange({ bodyWidth: v })}
        unit="mm"
        min={2}
        max={30}
      />
    </div>
  );
}

function QfnConfigPanel({ config }: { config: QfnConfig }) {
  const updateConfig = useFootprintEditorStore((s) => s.updateConfig);
  const setPads = useFootprintEditorStore((s) => s.setPads);
  const setGraphics = useFootprintEditorStore((s) => s.setGraphics);

  const handleChange = useCallback(
    (updates: Partial<QfnConfig>) => {
      const newConfig = { ...config, ...updates } as PresetConfig;
      updateConfig(newConfig);
      const { pads, graphics } = generateFromPreset("qfn", newConfig);
      setPads(pads);
      setGraphics(graphics);
    },
    [config, updateConfig, setPads, setGraphics],
  );

  return (
    <div className="space-y-3">
      <NumberInput
        label="Pins Per Side"
        value={config.pinsPerSide}
        onChange={(v) =>
          handleChange({ pinsPerSide: Math.max(4, Math.round(v)) })
        }
        unit=""
        min={4}
        max={40}
      />
      <NumberInput
        label="Pitch"
        value={config.pitch}
        onChange={(v) => handleChange({ pitch: v })}
        unit="mm"
        min={0.4}
        max={1}
      />
      <NumberInput
        label="Pad Width"
        value={config.padWidth}
        onChange={(v) => handleChange({ padWidth: v })}
        unit="mm"
        min={0.15}
        max={0.8}
      />
      <NumberInput
        label="Pad Height"
        value={config.padHeight}
        onChange={(v) => handleChange({ padHeight: v })}
        unit="mm"
        min={0.3}
        max={1.5}
      />
      <NumberInput
        label="Body Width"
        value={config.bodyWidth}
        onChange={(v) => handleChange({ bodyWidth: v })}
        unit="mm"
        min={2}
        max={15}
      />
      <div className="flex items-center gap-2 pt-2">
        <input
          type="checkbox"
          id="hasCenterPad"
          checked={config.hasCenterPad}
          onChange={(e) => handleChange({ hasCenterPad: e.target.checked })}
          className="rounded border-border-default"
        />
        <label htmlFor="hasCenterPad" className="text-xs text-text-secondary">
          Center Thermal Pad
        </label>
      </div>
      {config.hasCenterPad && (
        <NumberInput
          label="Center Pad Size"
          value={config.centerPadSize}
          onChange={(v) => handleChange({ centerPadSize: v })}
          unit="mm"
          min={0.5}
          max={10}
        />
      )}
    </div>
  );
}

function BgaConfigPanel({ config }: { config: BgaConfig }) {
  const updateConfig = useFootprintEditorStore((s) => s.updateConfig);
  const setPads = useFootprintEditorStore((s) => s.setPads);
  const setGraphics = useFootprintEditorStore((s) => s.setGraphics);

  const handleChange = useCallback(
    (updates: Partial<BgaConfig>) => {
      const newConfig = { ...config, ...updates } as PresetConfig;
      updateConfig(newConfig);
      const { pads, graphics } = generateFromPreset("bga", newConfig);
      setPads(pads);
      setGraphics(graphics);
    },
    [config, updateConfig, setPads, setGraphics],
  );

  return (
    <div className="space-y-3">
      <NumberInput
        label="Columns"
        value={config.cols}
        onChange={(v) => handleChange({ cols: Math.max(2, Math.round(v)) })}
        unit=""
        min={2}
        max={50}
      />
      <NumberInput
        label="Rows"
        value={config.rows}
        onChange={(v) => handleChange({ rows: Math.max(2, Math.round(v)) })}
        unit=""
        min={2}
        max={50}
      />
      <NumberInput
        label="Pitch"
        value={config.pitch}
        onChange={(v) => handleChange({ pitch: v })}
        unit="mm"
        min={0.4}
        max={2}
      />
      <NumberInput
        label="Ball Diameter"
        value={config.ballDiameter}
        onChange={(v) => handleChange({ ballDiameter: v })}
        unit="mm"
        min={0.2}
        max={1}
      />
    </div>
  );
}

function DipConfigPanel({ config }: { config: DipConfig }) {
  const updateConfig = useFootprintEditorStore((s) => s.updateConfig);
  const setPads = useFootprintEditorStore((s) => s.setPads);
  const setGraphics = useFootprintEditorStore((s) => s.setGraphics);

  const handleChange = useCallback(
    (updates: Partial<DipConfig>) => {
      const newConfig = { ...config, ...updates } as PresetConfig;
      updateConfig(newConfig);
      const { pads, graphics } = generateFromPreset("dip", newConfig);
      setPads(pads);
      setGraphics(graphics);
    },
    [config, updateConfig, setPads, setGraphics],
  );

  return (
    <div className="space-y-3">
      <NumberInput
        label="Pin Count"
        value={config.pinCount}
        onChange={(v) =>
          handleChange({ pinCount: Math.max(4, Math.round(v / 2) * 2) })
        }
        unit=""
        min={4}
        max={48}
        step={2}
      />
      <NumberInput
        label="Pitch"
        value={config.pitch}
        onChange={(v) => handleChange({ pitch: v })}
        unit="mm"
        min={1.27}
        max={2.54}
      />
      <NumberInput
        label="Row Spacing"
        value={config.rowSpacing}
        onChange={(v) => handleChange({ rowSpacing: v })}
        unit="mm"
        min={5}
        max={20}
      />
      <NumberInput
        label="Drill Diameter"
        value={config.drillDiameter}
        onChange={(v) => handleChange({ drillDiameter: v })}
        unit="mm"
        min={0.6}
        max={1.5}
      />
      <NumberInput
        label="Pad Diameter"
        value={config.padDiameter}
        onChange={(v) => handleChange({ padDiameter: v })}
        unit="mm"
        min={1}
        max={3}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

/** Presets that use the chip 2-terminal config panel */
const CHIP_LIKE_PRESETS = new Set(["chip_2terminal", "sod", "polarized_cap"]);
/** Presets that use the SOIC config panel */
const SOIC_LIKE_PRESETS = new Set(["soic", "soj"]);
/** Presets that use the QFP config panel */
const QFP_LIKE_PRESETS = new Set(["qfp", "plcc"]);
/** Presets with fixed dimensions (no editable config) */
const FIXED_PRESETS = new Set(["import", "sot", "dpak", "melf"]);

export function PresetConfigPanel() {
  const preset = useFootprintEditorStore((s) => s.draft.preset);
  const config = useFootprintEditorStore((s) => s.draft.config);
  const densityLevel = useFootprintEditorStore((s) => s.draft.densityLevel);
  const setDensityLevel = useFootprintEditorStore((s) => s.setDensityLevel);

  if (FIXED_PRESETS.has(preset)) {
    return (
      <div className="space-y-4">
        <DensitySelector value={densityLevel} onChange={setDensityLevel} />
        <div className="p-3 rounded-lg bg-bg-secondary text-xs text-text-muted">
          {preset === "import" &&
            "Import a .kicad_mod file to configure footprint."}
          {preset === "sot" && "SOT presets have fixed dimensions per variant."}
          {preset === "dpak" && "D-PAK dimensions are fixed per variant."}
          {preset === "melf" &&
            "MELF dimensions use standard cylindrical sizes."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DensitySelector value={densityLevel} onChange={setDensityLevel} />
      <h3 className="text-sm font-medium text-text-primary">Dimensions</h3>
      {CHIP_LIKE_PRESETS.has(preset) && (
        <Chip2TerminalConfigPanel config={config as Chip2TerminalConfig} />
      )}
      {SOIC_LIKE_PRESETS.has(preset) && (
        <SoicConfigPanel config={config as SoicConfig} />
      )}
      {QFP_LIKE_PRESETS.has(preset) && (
        <QfpConfigPanel config={config as QfpConfig} />
      )}
      {preset === "qfn" && <QfnConfigPanel config={config as QfnConfig} />}
      {preset === "bga" && <BgaConfigPanel config={config as BgaConfig} />}
      {preset === "dip" && <DipConfigPanel config={config as DipConfig} />}
    </div>
  );
}
