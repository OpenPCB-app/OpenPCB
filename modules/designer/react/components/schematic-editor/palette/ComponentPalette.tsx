import { useEffect, useMemo } from "react";
import { GripVertical, Package, RefreshCw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSchematicStore } from "@/stores/schematic-store";
import { useNavigationStore } from "@/stores/navigation-store";
import { PALETTE_SYMBOL_KIND_MIME } from "../symbol-library";
import { createImportedSymbolLayout } from "../symbol-library";
import {
  SYMBOL_CATEGORIES,
  mapCategoryPathToCategory,
} from "../symbol-display";
import { useComponents } from "@/hooks/useComponents";
import type { ComponentType } from "@shared/types/component-library-schema.types";
import type { SymbolCategory } from "../symbol-display";
import {
  DEFAULT_PIN_LENGTH,
  type PinElectricalType,
  type SymbolDraft,
  type SymbolGraphic,
  type SymbolPin,
} from "@/components/symbol-editor/types";
import { parseKicadSymbolImport } from "@/lib/api/component-api";
import { convertParsedKicadSymbolToDraft } from "@/components/symbol-editor/kicad-import";
import {
  hasStoredImportedSymbolNormalization,
  setDraftImportedSymbolNormalization,
} from "@/components/symbol-editor/import-normalization";
import {
  useSchematicInteractionController,
  type SchematicInteractionController,
} from "../useSchematicInteractionController";

interface ComponentPaletteProps {
  controller?: SchematicInteractionController;
}

const VALID_PIN_SIDES = new Set(["left", "right", "top", "bottom"]);
const VALID_PIN_ELECTRICAL_TYPES = new Set<PinElectricalType>([
  "passive",
  "input",
  "output",
  "bidirectional",
  "power_in",
  "power_out",
  "open_collector",
  "open_emitter",
  "unspecified",
]);

function isPinSide(value: unknown): value is SymbolPin["side"] {
  return typeof value === "string" && VALID_PIN_SIDES.has(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toElectricalType(value: unknown): PinElectricalType {
  if (typeof value === "string" && VALID_PIN_ELECTRICAL_TYPES.has(value as PinElectricalType)) {
    return value as PinElectricalType;
  }
  return "passive";
}

function toStoredPin(value: unknown, index: number): SymbolPin | null {
  const pin = asRecord(value);
  if (!pin) {
    return null;
  }

  const position = asRecord(pin.position);
  const x = position?.x;
  const y = position?.y;
  if (typeof x !== "number" || typeof y !== "number") {
    return null;
  }

  const name =
    typeof pin.name === "string" && pin.name.trim().length > 0
      ? pin.name
      : typeof pin.number === "string" && pin.number.trim().length > 0
        ? pin.number
        : String(index + 1);
  const number =
    typeof pin.number === "string" && pin.number.trim().length > 0
      ? pin.number
      : String(index + 1);
  const side: SymbolPin["side"] = isPinSide(pin.side) ? pin.side : "left";

  return {
    id: `stored-pin-${index + 1}`,
    name,
    number,
    electricalType: toElectricalType(pin.electricalType),
    side,
    position: { x, y },
    length: typeof pin.length === "number" ? pin.length : DEFAULT_PIN_LENGTH,
  };
}

function toStoredGraphics(value: unknown): SymbolGraphic[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((graphic) => {
      const record = asRecord(graphic);
      return record !== null && typeof record.type === "string";
    })
    .map((graphic) => graphic as SymbolGraphic);
}

function getStoredImportedDraft(
  component: ComponentType,
): Pick<SymbolDraft, "pins" | "graphics" | "importPreservation"> | null {
  if (!Array.isArray(component.symbolData.pins) || component.symbolData.pins.length === 0) {
    return null;
  }

  const pins = component.symbolData.pins
    .map((pin, index) => toStoredPin(pin, index))
    .filter((pin): pin is SymbolPin => pin !== null);
  if (pins.length === 0) {
    return null;
  }

  return {
    pins,
    graphics: toStoredGraphics(component.symbolData.bodyGraphics),
    importPreservation: {
      rawSource: component.symbolData.rawKicadSource ?? null,
      sourceFileName: null,
      warnings: [],
      graphicsEditable: true,
      normalizedSchematicGeometry: hasStoredImportedSymbolNormalization(
        component.symbolData.properties,
      ),
    },
  };
}

function groupComponentsByCategory(
  components: ComponentType[],
): Map<SymbolCategory, ComponentType[]> {
  const groups = new Map<SymbolCategory, ComponentType[]>();
  for (const category of SYMBOL_CATEGORIES) {
    groups.set(category.key, []);
  }
  for (const component of components) {
    const category = mapCategoryPathToCategory(component.categoryPath ?? null);
    const group = groups.get(category);
    if (group) {
      group.push(component);
    }
  }
  return groups;
}

function FamilyItem({
  component,
  isActive,
  onDragStart,
  onDragEnd,
}: {
  component: ComponentType;
  isActive: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const prefix = component.symbolData.referencePrefix;
  const variantCount = getComponentVariants(component).length;
  return (
    <Button
      type="button"
      variant={isActive ? "default" : "ghost"}
      size="sm"
      draggable
      className="h-auto w-full items-start justify-start gap-3 px-3 py-2 text-left"
      onDragStart={(event) => {
        onDragStart();
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(PALETTE_SYMBOL_KIND_MIME, component.id);
        event.dataTransfer.setData("text/plain", component.id);
      }}
      onClick={onDragStart}
      onDragEnd={onDragEnd}
    >
      <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs font-medium">{component.displayLabel}</span>
        <span className="text-[10px] text-text-muted">
          {prefix} {variantCount > 1 ? `(${variantCount} variants)` : ""}
        </span>
      </span>
    </Button>
  );
}

function LegacyItem({
  kind,
  label,
  badge,
  isActive,
  onDragStart,
  onDragEnd,
}: {
  kind: string;
  label: string;
  badge: string;
  isActive: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <Button
      type="button"
      variant={isActive ? "default" : "ghost"}
      size="sm"
      draggable
      className="h-auto w-full items-start justify-start gap-3 px-3 py-2 text-left"
      onDragStart={(event) => {
        onDragStart();
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(PALETTE_SYMBOL_KIND_MIME, kind);
        event.dataTransfer.setData("text/plain", kind);
      }}
      onClick={onDragStart}
      onDragEnd={onDragEnd}
    >
      <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs font-medium">{label}</span>
      </span>
      <span className="rounded border border-border-default px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
        {badge}
      </span>
    </Button>
  );
}

/**
 * Embedded net-defining symbols (GND/VCC only).
 * All physical components come from the Component Library.
 */
const EMBEDDED_SYMBOLS: Array<{
  kind: string;
  label: string;
  badge: string;
  category: SymbolCategory;
}> = [];

function EmptyState() {
  const navigateToLibrary = useNavigationStore((s) => s.navigateToLibrary);
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
      <Package className="h-10 w-10 text-text-muted" />
      <div>
        <p className="text-sm font-medium text-text-secondary">No components</p>
        <p className="text-xs text-text-muted">
          Create components in the Library screen
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={navigateToLibrary}>
        Open Library
      </Button>
    </div>
  );
}

export function ComponentPalette({ controller }: ComponentPaletteProps) {
  const fallbackController = useSchematicInteractionController();
  const interactionController = controller ?? fallbackController;
  const session = useSchematicStore((s) => s.session);
  const draggedSymbolKind = useSchematicStore((s) => s.draggedSymbolKind);
  const setPaletteDragSymbolKind = useSchematicStore(
    (s) => s.setPaletteDragSymbolKind,
  );
  const setComponentLibrary = useSchematicStore((s) => s.setComponentLibrary);
  const { components, loading, error, refetch } = useComponents();
  const activeSymbolKind =
    session?.type === "placement" ? session.symbolKind : draggedSymbolKind;

  const groupedComponents = useMemo(
    () => groupComponentsByCategory(components),
    [components],
  );

  useEffect(() => {
    setComponentLibrary(components);

    let cancelled = false;
    const storedEntries: Array<
      readonly [string, ReturnType<typeof createImportedSymbolLayout>]
    > = [];
    const fallbackComponents: ComponentType[] = [];

    for (const component of components) {
      const storedDraft = getStoredImportedDraft(component);
      if (storedDraft) {
        storedEntries.push([
          component.id,
          createImportedSymbolLayout(storedDraft),
        ]);
        continue;
      }

      if (typeof component.symbolData.rawKicadSource === "string") {
        fallbackComponents.push(component);
      }
    }

    if (fallbackComponents.length === 0) {
      if (storedEntries.length > 0) {
        setComponentLibrary(components, new Map(storedEntries));
      }
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(
      fallbackComponents.map(async (component) => {
        try {
          const parsed = await parseKicadSymbolImport(
            component.symbolData.rawKicadSource!,
          );
          const draft = convertParsedKicadSymbolToDraft(
            parsed.symbol,
            component.displayLabel,
            parsed.availableSymbols.length,
          );
          return [
            component.id,
            createImportedSymbolLayout(
              setDraftImportedSymbolNormalization(
                draft,
                hasStoredImportedSymbolNormalization(
                  component.symbolData.properties,
                ),
              ),
            ),
          ] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) {
        return;
      }

      const importedLayouts = new Map(
        [
          ...storedEntries,
          ...entries.filter(
            (
              entry,
            ): entry is readonly [
              string,
              ReturnType<typeof createImportedSymbolLayout>,
            ] => entry !== null,
          ),
        ],
      );

      if (importedLayouts.size > 0) {
        setComponentLibrary(components, importedLayouts);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [components, setComponentLibrary]);

  const hasComponents = components.length > 0 || EMBEDDED_SYMBOLS.length > 0;
  const handleLegacyDragStart = (kind: string) => {
    setPaletteDragSymbolKind(kind);
    interactionController.beginPlacement(kind);
  };
  const handleFamilyDragStart = (component: ComponentType) => {
    setPaletteDragSymbolKind(component.id);
    interactionController.beginPlacement(component.id);
  };
  const handleDragEnd = () => {
    setPaletteDragSymbolKind(null);
    interactionController.cancelSession();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border-default px-3 py-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-medium tracking-wider text-text-secondary uppercase">
            Drag To Canvas
          </p>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => void refetch()}
            title="Refresh components"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {error && (
        <div className="border-b border-border-warning bg-surface-warning px-3 py-2">
          <p className="text-xs text-text-warning">{error}</p>
        </div>
      )}

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex flex-col gap-2 p-2">
            {[
              "component-palette-skeleton-1",
              "component-palette-skeleton-2",
              "component-palette-skeleton-3",
              "component-palette-skeleton-4",
              "component-palette-skeleton-5",
              "component-palette-skeleton-6",
              "component-palette-skeleton-7",
              "component-palette-skeleton-8",
            ].map((key) => (
              <Skeleton key={key} className="h-8 w-full" />
            ))}
          </div>
        ) : !hasComponents ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {SYMBOL_CATEGORIES.map((category) => {
              const families = groupedComponents.get(category.key) ?? [];
              const embeddedItems = EMBEDDED_SYMBOLS.filter(
                (item) => item.category === category.key,
              );
              if (families.length === 0 && embeddedItems.length === 0)
                return null;

              return (
                <div key={category.key} className="mb-1">
                  <div className="px-1 py-1.5">
                    <span className="text-[9px] font-semibold tracking-widest text-text-muted uppercase">
                      {category.label}
                    </span>
                  </div>
                  {embeddedItems.map((item) => (
                    <LegacyItem
                      key={item.kind}
                      kind={item.kind}
                      label={item.label}
                      badge={item.badge}
                      isActive={activeSymbolKind === item.kind}
                      onDragStart={() => handleLegacyDragStart(item.kind)}
                      onDragEnd={handleDragEnd}
                    />
                  ))}
                  {families.map((family) => (
                    <FamilyItem
                      key={family.id}
                      component={family}
                      isActive={activeSymbolKind === family.id}
                      onDragStart={() => handleFamilyDragStart(family)}
                      onDragEnd={handleDragEnd}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function getComponentVariants(component: ComponentType) {
  return component.variants;
}
