/**
 * Pin Properties Panel
 *
 * Panel for editing properties of selected pins.
 */

import { useCallback, useMemo } from "react";
import { useSymbolEditorStore } from "./symbol-editor-store";
import type { PinElectricalType, PinSide, Nanometers } from "./types";
import { DEFAULT_PIN_LENGTH, GRID_SIZES } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ELECTRICAL_TYPES: { value: PinElectricalType; label: string }[] = [
  { value: "input", label: "Input" },
  { value: "output", label: "Output" },
  { value: "bidirectional", label: "Bidirectional" },
  { value: "passive", label: "Passive" },
  { value: "power_in", label: "Power In" },
  { value: "power_out", label: "Power Out" },
  { value: "open_collector", label: "Open Collector" },
  { value: "open_emitter", label: "Open Emitter" },
  { value: "unspecified", label: "Unspecified" },
];

const PIN_SIDES: { value: PinSide; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
];

const PIN_LENGTHS: { value: Nanometers; label: string }[] = [
  { value: GRID_SIZES.fine, label: "Short (0.025\")" },
  { value: GRID_SIZES.normal, label: "Normal (0.05\")" },
  { value: DEFAULT_PIN_LENGTH, label: "Standard (0.1\")" },
  { value: DEFAULT_PIN_LENGTH * 2, label: "Long (0.2\")" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PinPropertiesPanel() {
  const draft = useSymbolEditorStore((s) => s.draft);
  const selection = useSymbolEditorStore((s) => s.chrome.selection);
  const updatePin = useSymbolEditorStore((s) => s.updatePin);
  const removePin = useSymbolEditorStore((s) => s.removePin);
  const removePins = useSymbolEditorStore((s) => s.removePins);

  const selectedPinIds = useMemo(
    () => [...selection.selectedPinIds],
    [selection.selectedPinIds],
  );

  const selectedPins = useMemo(
    () => draft.pins.filter((p) => selection.selectedPinIds.has(p.id)),
    [draft.pins, selection.selectedPinIds],
  );

  const singlePin = selectedPins.length === 1 ? selectedPins[0] : null;

  // Check if all selected pins share same value
  const getSharedValue = useCallback(
    <T,>(getter: (pin: (typeof selectedPins)[0]) => T): T | null => {
      if (selectedPins.length === 0) return null;
      const firstValue = getter(selectedPins[0]!);
      const allSame = selectedPins.every((p) => getter(p) === firstValue);
      return allSame ? firstValue : null;
    },
    [selectedPins],
  );

  const sharedElectricalType = getSharedValue((p) => p.electricalType);
  const sharedSide = getSharedValue((p) => p.side);
  const sharedLength = getSharedValue((p) => p.length);

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (singlePin) {
        updatePin(singlePin.id, { name: e.target.value });
      }
    },
    [singlePin, updatePin],
  );

  const handleNumberChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (singlePin) {
        updatePin(singlePin.id, { number: e.target.value });
      }
    },
    [singlePin, updatePin],
  );

  const handleElectricalTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const electricalType = e.target.value as PinElectricalType;
      for (const id of selectedPinIds) {
        updatePin(id, { electricalType });
      }
    },
    [selectedPinIds, updatePin],
  );

  const handleSideChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const side = e.target.value as PinSide;
      for (const id of selectedPinIds) {
        updatePin(id, { side });
      }
    },
    [selectedPinIds, updatePin],
  );

  const handleLengthChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const length = Number(e.target.value) as Nanometers;
      for (const id of selectedPinIds) {
        updatePin(id, { length });
      }
    },
    [selectedPinIds, updatePin],
  );

  const handleDelete = useCallback(() => {
    if (selectedPinIds.length === 1) {
      removePin(selectedPinIds[0]!);
    } else if (selectedPinIds.length > 1) {
      removePins(selectedPinIds);
    }
  }, [selectedPinIds, removePin, removePins]);

  if (selectedPins.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-2">
        <div className="text-sm font-medium text-muted-foreground">Pin Properties</div>
        <div className="text-sm text-muted-foreground italic">
          Select a pin to edit its properties
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-2">
      <div className="text-sm font-medium text-muted-foreground">
        Pin Properties {selectedPins.length > 1 && `(${selectedPins.length} selected)`}
      </div>

      {/* Name (single pin only) */}
      {singlePin && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Name</label>
          <input
            type="text"
            value={singlePin.name}
            onChange={handleNameChange}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none"
            placeholder="Pin name"
          />
        </div>
      )}

      {/* Number (single pin only) */}
      {singlePin && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Number</label>
          <input
            type="text"
            value={singlePin.number}
            onChange={handleNumberChange}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none"
            placeholder="Pin number"
          />
        </div>
      )}

      {/* Electrical Type */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Electrical Type</label>
        <select
          value={sharedElectricalType ?? ""}
          onChange={handleElectricalTypeChange}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none"
        >
          {!sharedElectricalType && (
            <option value="" disabled>
              (mixed)
            </option>
          )}
          {ELECTRICAL_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </div>

      {/* Side */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Side</label>
        <select
          value={sharedSide ?? ""}
          onChange={handleSideChange}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none"
        >
          {!sharedSide && (
            <option value="" disabled>
              (mixed)
            </option>
          )}
          {PIN_SIDES.map((side) => (
            <option key={side.value} value={side.value}>
              {side.label}
            </option>
          ))}
        </select>
      </div>

      {/* Length */}
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Length</label>
        <select
          value={sharedLength ?? ""}
          onChange={handleLengthChange}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none"
        >
          {!sharedLength && (
            <option value="" disabled>
              (mixed)
            </option>
          )}
          {PIN_LENGTHS.map((len) => (
            <option key={len.value} value={len.value}>
              {len.label}
            </option>
          ))}
        </select>
      </div>

      {/* Delete button */}
      <button
        onClick={handleDelete}
        className="mt-2 rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground transition-colors hover:bg-destructive/90"
      >
        Delete {selectedPins.length > 1 ? `${selectedPins.length} Pins` : "Pin"}
      </button>
    </div>
  );
}
