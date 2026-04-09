/**
 * PadPropertiesPanel Component
 *
 * Displays and edits properties of selected pads.
 */

import { useCallback } from "react";
import { useFootprintEditorStore } from "./footprint-editor-store";
import type { PadDefinition, PadShape, PadLayer } from "./types";

const PAD_SHAPES: { value: PadShape; label: string }[] = [
  { value: "rect", label: "Rectangle" },
  { value: "roundrect", label: "Rounded Rect" },
  { value: "oval", label: "Oval" },
  { value: "circle", label: "Circle" },
  { value: "trapezoid", label: "Trapezoid" },
];

const PAD_LAYERS: { value: PadLayer; label: string }[] = [
  { value: "F.Cu", label: "F.Cu" },
  { value: "F.Mask", label: "F.Mask" },
  { value: "F.Paste", label: "F.Paste" },
  { value: "B.Cu", label: "B.Cu" },
  { value: "B.Mask", label: "B.Mask" },
];

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

function NumberInput({ label, value, onChange, unit, min, max, step = 0.01, disabled }: NumberInputProps) {
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

export function PadPropertiesPanel() {
  const selection = useFootprintEditorStore((s) => s.chrome.selection);
  const pads = useFootprintEditorStore((s) => s.draft.pads);
  const updatePad = useFootprintEditorStore((s) => s.updatePad);
  const removePad = useFootprintEditorStore((s) => s.removePad);

  const selectedPadIds = [...selection.selectedPadIds];
  const hasSelection = selectedPadIds.length > 0;
  const singleSelection = selectedPadIds.length === 1;

  const selectedPad = singleSelection ? pads.find((p) => p.id === selectedPadIds[0]) : null;

  const handleUpdate = useCallback(
    (updates: Partial<Omit<PadDefinition, "id">>) => {
      if (singleSelection && selectedPad) {
        updatePad(selectedPad.id, updates);
      }
    },
    [singleSelection, selectedPad, updatePad],
  );

  const handleDelete = useCallback(() => {
    if (hasSelection) {
      removePad(selectedPadIds[0]!);
    }
  }, [hasSelection, selectedPadIds, removePad]);

  const handleLayerToggle = useCallback(
    (layer: PadLayer, checked: boolean) => {
      if (!singleSelection || !selectedPad) return;
      const newLayers = checked
        ? [...selectedPad.layers, layer]
        : selectedPad.layers.filter((l) => l !== layer);
      updatePad(selectedPad.id, { layers: newLayers });
    },
    [singleSelection, selectedPad, updatePad],
  );

  if (!hasSelection) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-primary">Pad Properties</h3>
        <p className="text-xs text-text-muted italic">
          Select a pad to edit its properties
        </p>
      </div>
    );
  }

  if (!singleSelection) {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-primary">Pad Properties</h3>
        <p className="text-xs text-text-secondary">
          {selectedPadIds.length} pads selected
        </p>
        <button
          onClick={() => {/* TODO: bulk remove */}}
          className="w-full h-8 rounded-md bg-error/10 text-error text-sm hover:bg-error/20 transition-colors"
        >
          Delete Selected
        </button>
      </div>
    );
  }

  if (!selectedPad) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-text-primary">Pad Properties</h3>

      <div className="space-y-3">
        {/* Pad Number */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-secondary">Number</label>
          <input
            type="text"
            value={selectedPad.number}
            onChange={(e) => handleUpdate({ number: e.target.value })}
            className="w-full h-8 rounded-md bg-bg-input px-2 text-sm text-text-primary border border-border-default focus:border-border-strong focus:outline-none"
          />
        </div>

        {/* Pad Name */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-secondary">Name (optional)</label>
          <input
            type="text"
            value={selectedPad.name}
            onChange={(e) => handleUpdate({ name: e.target.value })}
            placeholder="e.g., GND, VCC"
            className="w-full h-8 rounded-md bg-bg-input px-2 text-sm text-text-primary border border-border-default focus:border-border-strong focus:outline-none placeholder:text-text-tertiary"
          />
        </div>

        {/* Pad Shape */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-secondary">Shape</label>
          <select
            value={selectedPad.shape}
            onChange={(e) => handleUpdate({ shape: e.target.value as PadShape })}
            className="w-full h-8 rounded-md bg-bg-input px-2 text-sm text-text-primary border border-border-default focus:border-border-strong focus:outline-none"
          >
            {PAD_SHAPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* Dimensions */}
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="Width"
            value={selectedPad.size.width}
            onChange={(v) => handleUpdate({ size: { ...selectedPad.size, width: v } })}
            unit="mm"
            min={0.1}
            max={10}
          />
          <NumberInput
            label="Height"
            value={selectedPad.size.height}
            onChange={(v) => handleUpdate({ size: { ...selectedPad.size, height: v } })}
            unit="mm"
            min={0.1}
            max={10}
          />
        </div>

        {/* Rotation */}
        <NumberInput
          label="Rotation"
          value={selectedPad.rotation}
          onChange={(v) => handleUpdate({ rotation: v })}
          unit="deg"
          min={0}
          max={360}
          step={1}
        />

        {/* Roundrect Ratio */}
        {selectedPad.shape === "roundrect" && (
          <NumberInput
            label="Corner Ratio"
            value={selectedPad.roundrectRatio ?? 0.25}
            onChange={(v) => handleUpdate({ roundrectRatio: Math.max(0, Math.min(0.5, v)) })}
            unit=""
            min={0}
            max={0.5}
            step={0.05}
          />
        )}

        {/* Layers */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-text-secondary">Layers</label>
          <div className="flex flex-wrap gap-2">
            {PAD_LAYERS.map((layer) => (
              <label
                key={layer.value}
                className="flex items-center gap-1 text-xs text-text-secondary"
              >
                <input
                  type="checkbox"
                  checked={selectedPad.layers.includes(layer.value)}
                  onChange={(e) => handleLayerToggle(layer.value, e.target.checked)}
                  className="rounded border-border-default"
                />
                {layer.label}
              </label>
            ))}
          </div>
        </div>

        {/* Pin Mapping */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-secondary">Pin Mapping</label>
          <input
            type="text"
            value={selectedPad.pinMapping ?? ""}
            onChange={(e) => handleUpdate({ pinMapping: e.target.value || undefined })}
            placeholder="Symbol pin number"
            className="w-full h-8 rounded-md bg-bg-input px-2 text-sm text-text-primary border border-border-default focus:border-border-strong focus:outline-none placeholder:text-text-tertiary"
          />
          <p className="text-[10px] text-text-muted">
            Map this pad to a symbol pin by number
          </p>
        </div>

        {/* Position */}
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="X"
            value={selectedPad.position.x}
            onChange={(v) => handleUpdate({ position: { ...selectedPad.position, x: v } })}
            unit="mm"
          />
          <NumberInput
            label="Y"
            value={selectedPad.position.y}
            onChange={(v) => handleUpdate({ position: { ...selectedPad.position, y: v } })}
            unit="mm"
          />
        </div>

        {/* Delete */}
        <button
          onClick={handleDelete}
          className="w-full h-8 rounded-md bg-error/10 text-error text-sm hover:bg-error/20 transition-colors"
        >
          Delete Pad
        </button>
      </div>
    </div>
  );
}