import { useState, useEffect, useRef } from "react";
import { schematicToScreen } from "@/components/pcb/canvas/viewport";
import type { Bounds, SymbolEntity, Viewport } from "@/components/pcb/types";
import { getSymbolKindLabel } from "@/components/pcb/symbol-display";
import { useSchematicStore } from "@/stores/schematic-store";

const POPOVER_OFFSET_PX = 12;

interface PopoverPosition {
  left: number;
  top: number;
}

function getSelectedSymbol(
  symbolId: string | null,
  selectedIds: Set<string>,
  symbols: SymbolEntity[],
): SymbolEntity | null {
  if (!symbolId || selectedIds.size !== 1 || !selectedIds.has(symbolId)) {
    return null;
  }

  return symbols.find((symbol) => symbol.id === symbolId) ?? null;
}

function getFootprintEntry(symbol: SymbolEntity): [string, string] | null {
  const properties = symbol.properties ?? {};

  for (const [key, value] of Object.entries(properties)) {
    if (key.trim().toLowerCase() === "footprint") {
      return [key, value];
    }
  }

  return null;
}

function getPropertyEntries(
  symbol: SymbolEntity,
  omittedKey: string | null,
): Array<[string, string]> {
  return Object.entries(symbol.properties ?? {})
    .filter(([key]) => key !== omittedKey)
    .sort(([left], [right]) => left.localeCompare(right));
}

export function getFloatingPopoverPosition(
  bounds: Bounds,
  viewport: Viewport,
): PopoverPosition {
  const screenMin = schematicToScreen(bounds.minX, bounds.minY, viewport);
  const screenMax = schematicToScreen(bounds.maxX, bounds.maxY, viewport);

  return {
    left: Math.max(screenMin.x, screenMax.x) + POPOVER_OFFSET_PX,
    top: (screenMin.y + screenMax.y) / 2,
  };
}

function PropertyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium tracking-wide text-text-muted uppercase">
        {label}
      </p>
      <p className="break-words text-xs text-text-primary">{value}</p>
    </div>
  );
}

function EditableValueRow({
  label,
  value,
  symbolId,
  isPowerSymbol,
}: {
  label: string;
  value: string;
  symbolId: string;
  isPowerSymbol: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateSymbolValue = useSchematicStore((s) => s.updateSymbolValue);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSubmit = () => {
    const trimmedValue = editValue.trim();
    if (trimmedValue && trimmedValue !== value) {
      updateSymbolValue(symbolId, trimmedValue);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    } else if (e.key === "Escape") {
      setEditValue(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div className="space-y-1">
        <p className="text-[10px] font-medium tracking-wide text-text-muted uppercase">
          {label}
        </p>
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={handleKeyDown}
          className="w-full rounded border border-border-default bg-bg-input px-1.5 py-0.5 text-xs text-text-primary focus:border-border-strong focus:outline-none"
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium tracking-wide text-text-muted uppercase">
        {label}
      </p>
      <button
        type="button"
        onClick={() => isPowerSymbol && setIsEditing(true)}
        className={`w-full rounded border border-transparent px-1.5 py-0.5 text-left text-xs ${
          isPowerSymbol
            ? "cursor-text text-text-primary hover:border-border-default hover:bg-bg-input"
            : "cursor-default text-text-primary"
        }`}
      >
        {value || "—"}
      </button>
    </div>
  );
}

export function FloatingPropertiesPopover() {
  const document = useSchematicStore((s) => s.persisted.document);
  const selectedIds = useSchematicStore((s) => s.chrome.selectedEntityIds);
  const popoverEntityId = useSchematicStore((s) => s.chrome.popoverEntityId);
  const setPopoverTarget = useSchematicStore((s) => s.setPopoverTarget);
  const viewport = useSchematicStore((s) => s.chrome.viewport);
  const bounds = useSchematicStore((s) =>
    popoverEntityId
      ? s.derived.hitTestCache.symbolBounds[popoverEntityId] ?? null
      : null,
  );
  const symbol = getSelectedSymbol(
    popoverEntityId,
    selectedIds,
    document?.symbols ?? [],
  );

  if (!symbol || !bounds) {
    return null;
  }

  const footprintEntry = getFootprintEntry(symbol);
  const propertyEntries = getPropertyEntries(
    symbol,
    footprintEntry?.[0] ?? null,
  );
  const position = getFloatingPopoverPosition(bounds, viewport);

  const isPowerSymbol =
    symbol.symbolKind === "gnd" || symbol.symbolKind === "vcc";

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20"
      data-testid="floating-properties-layer"
    >
      <button
        type="button"
        aria-label="Close symbol properties popover"
        className="pointer-events-auto absolute inset-0 cursor-default bg-transparent"
        data-testid="floating-properties-backdrop"
        onClick={() => setPopoverTarget(null)}
      />
      <div
        role="dialog"
        aria-label="Symbol properties"
        className="pointer-events-auto absolute w-72 rounded-lg border border-border-default bg-bg-secondary/95 shadow-2xl backdrop-blur"
        data-testid="floating-properties-popover"
        style={{
          left: `${position.left}px`,
          top: `${position.top}px`,
          transform: "translateY(-50%)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-border-default px-3 py-2">
          <p className="text-xs font-semibold text-text-primary">
            {symbol.reference}
          </p>
          <p className="text-[11px] text-text-muted capitalize">
            {getSymbolKindLabel(symbol.symbolKind)}
          </p>
        </div>
        <div className="max-h-80 space-y-3 overflow-y-auto px-3 py-3">
          <PropertyRow label="Reference" value={symbol.reference} />
          <EditableValueRow
            label="Value"
            value={symbol.value || ""}
            symbolId={symbol.id}
            isPowerSymbol={isPowerSymbol}
          />
          <PropertyRow label="Footprint" value={footprintEntry?.[1] || "—"} />
          {propertyEntries.length > 0 && (
            <div className="space-y-3 border-t border-border-default pt-3">
              {propertyEntries.map(([key, value]) => (
                <PropertyRow key={key} label={key} value={value || "—"} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
