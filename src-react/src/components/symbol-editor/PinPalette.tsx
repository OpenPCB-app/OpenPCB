/**
 * Pin Palette Component
 *
 * Draggable pin templates for adding pins to the symbol editor canvas.
 */

import { useCallback } from "react";
import { useSymbolEditorStore } from "./symbol-editor-store";
import {
  type PinElectricalType,
  type PinSide,
  type SymbolPin,
  PIN_DRAG_MIME,
  DEFAULT_PIN_LENGTH,
  createPin,
} from "./types";

// ---------------------------------------------------------------------------
// Pin Type Templates
// ---------------------------------------------------------------------------

interface PinTypeTemplate {
  electricalType: PinElectricalType;
  label: string;
  description: string;
  defaultSide: PinSide;
  color: string;
}

const PIN_TEMPLATES: PinTypeTemplate[] = [
  {
    electricalType: "input",
    label: "Input",
    description: "Input signal pin",
    defaultSide: "left",
    color: "#22c55e", // green
  },
  {
    electricalType: "output",
    label: "Output",
    description: "Output signal pin",
    defaultSide: "right",
    color: "#f97316", // orange
  },
  {
    electricalType: "bidirectional",
    label: "Bidirectional",
    description: "Bidirectional I/O pin",
    defaultSide: "left",
    color: "#3b82f6", // blue
  },
  {
    electricalType: "passive",
    label: "Passive",
    description: "Passive component pin",
    defaultSide: "left",
    color: "#94a3b8", // gray
  },
  {
    electricalType: "power_in",
    label: "Power In",
    description: "Power input (VCC, VDD)",
    defaultSide: "top",
    color: "#ef4444", // red
  },
  {
    electricalType: "power_out",
    label: "Power Out",
    description: "Power output",
    defaultSide: "top",
    color: "#dc2626", // dark red
  },
  {
    electricalType: "open_collector",
    label: "Open Collector",
    description: "Open collector output",
    defaultSide: "right",
    color: "#8b5cf6", // purple
  },
  {
    electricalType: "open_emitter",
    label: "Open Emitter",
    description: "Open emitter output",
    defaultSide: "right",
    color: "#a855f7", // purple
  },
  {
    electricalType: "unspecified",
    label: "Unspecified",
    description: "Unspecified pin type",
    defaultSide: "left",
    color: "#64748b", // slate
  },
];

// ---------------------------------------------------------------------------
// Pin Item Component
// ---------------------------------------------------------------------------

interface PinPaletteItemProps {
  template: PinTypeTemplate;
  onDragStart: (e: React.DragEvent, template: PinTypeTemplate) => void;
  onClick: (template: PinTypeTemplate) => void;
}

function PinPaletteItem({ template, onDragStart, onClick }: PinPaletteItemProps) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, template)}
      onClick={() => onClick(template)}
      className="flex cursor-grab items-center gap-2 rounded-md border border-border bg-card p-2 transition-colors hover:border-primary hover:bg-accent active:cursor-grabbing"
      title={template.description}
    >
      <div
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: template.color }}
      />
      <span className="text-sm">{template.label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pin Palette Component
// ---------------------------------------------------------------------------

export function PinPalette() {
  const addPin = useSymbolEditorStore((s) => s.addPin);
  const draft = useSymbolEditorStore((s) => s.draft);
  const gridSize = useSymbolEditorStore((s) => s.chrome.gridSize);

  const getNextPinNumber = useCallback((): string => {
    const existingNumbers = new Set(draft.pins.map((p) => p.number));
    let num = 1;
    while (existingNumbers.has(String(num))) {
      num++;
    }
    return String(num);
  }, [draft.pins]);

  const calculatePinPosition = useCallback(
    (side: PinSide): { x: number; y: number } => {
      // Get body dimensions
      const halfWidth = draft.body.width / 2;
      const halfHeight = draft.body.height / 2;

      // Count existing pins on this side
      const pinsOnSide = draft.pins.filter((p) => p.side === side);
      const pinIndex = pinsOnSide.length;

      // Calculate position based on side
      switch (side) {
        case "left":
          return {
            x: -halfWidth - DEFAULT_PIN_LENGTH,
            y: halfHeight - gridSize * (pinIndex + 1),
          };
        case "right":
          return {
            x: halfWidth + DEFAULT_PIN_LENGTH,
            y: halfHeight - gridSize * (pinIndex + 1),
          };
        case "top":
          return {
            x: -halfWidth + gridSize * (pinIndex + 1),
            y: halfHeight + DEFAULT_PIN_LENGTH,
          };
        case "bottom":
          return {
            x: -halfWidth + gridSize * (pinIndex + 1),
            y: -halfHeight - DEFAULT_PIN_LENGTH,
          };
      }
    },
    [draft.body.width, draft.body.height, draft.pins, gridSize],
  );

  const createNewPin = useCallback(
    (template: PinTypeTemplate): SymbolPin => {
      const pinNumber = getNextPinNumber();
      const position = calculatePinPosition(template.defaultSide);

      return createPin(crypto.randomUUID(), {
        name: `Pin ${pinNumber}`,
        number: pinNumber,
        electricalType: template.electricalType,
        side: template.defaultSide,
        position,
        length: DEFAULT_PIN_LENGTH,
      });
    },
    [getNextPinNumber, calculatePinPosition],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, template: PinTypeTemplate) => {
      e.dataTransfer.setData(PIN_DRAG_MIME, JSON.stringify(template));
      e.dataTransfer.effectAllowed = "copy";
    },
    [],
  );

  const handleClick = useCallback(
    (template: PinTypeTemplate) => {
      const pin = createNewPin(template);
      addPin(pin);
    },
    [createNewPin, addPin],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium text-muted-foreground">Pin Types</div>
      <div className="grid grid-cols-2 gap-1">
        {PIN_TEMPLATES.map((template) => (
          <PinPaletteItem
            key={template.electricalType}
            template={template}
            onDragStart={handleDragStart}
            onClick={handleClick}
          />
        ))}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        Click to add or drag to position
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { PIN_TEMPLATES };
export type { PinTypeTemplate };
