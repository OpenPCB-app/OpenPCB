import { useEffect, useMemo } from "react";
import { GripVertical, Package, RefreshCw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSchematicStore } from "@/stores/schematic-store";
import { useNavigationStore } from "@/stores/navigation-store";
import { PALETTE_SYMBOL_KIND_MIME } from "../symbol-library";
import {
  SYMBOL_CATEGORIES,
  mapCategoryPathToCategory,
} from "../symbol-display";
import { useComponents } from "@/hooks/useComponents";
import type { ComponentFamilyType } from "@/../../src-ts/src/core/schemas/component-library.schema";
import type { SymbolCategory } from "../symbol-display";
import {
  useSchematicInteractionController,
  type SchematicInteractionController,
} from "../useSchematicInteractionController";

interface ComponentPaletteProps {
  controller?: SchematicInteractionController;
}

function groupFamiliesByCategory(
  families: ComponentFamilyType[],
): Map<SymbolCategory, ComponentFamilyType[]> {
  const groups = new Map<SymbolCategory, ComponentFamilyType[]>();
  for (const category of SYMBOL_CATEGORIES) {
    groups.set(category.key, []);
  }
  for (const family of families) {
    const category = mapCategoryPathToCategory(family.categoryPath ?? null);
    const group = groups.get(category);
    if (group) {
      group.push(family);
    }
  }
  return groups;
}

function FamilyItem({
  family,
  isActive,
  onDragStart,
  onDragEnd,
}: {
  family: ComponentFamilyType;
  isActive: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const prefix = family.symbolData.referencePrefix;
  const variantCount = family.packageVariants?.length ?? 0;
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
        event.dataTransfer.setData(PALETTE_SYMBOL_KIND_MIME, family.id);
        event.dataTransfer.setData("text/plain", family.id);
      }}
      onClick={onDragStart}
      onDragEnd={onDragEnd}
    >
      <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs font-medium">{family.displayLabel}</span>
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
}> = [
  { kind: "gnd", label: "Ground", badge: "GND", category: "power" },
  { kind: "vcc", label: "VCC", badge: "VCC", category: "power" },
];

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

  const groupedFamilies = useMemo(
    () => groupFamiliesByCategory(components),
    [components],
  );

  useEffect(() => {
    setComponentLibrary(components);
  }, [components, setComponentLibrary]);

  const hasComponents = components.length > 0 || EMBEDDED_SYMBOLS.length > 0;
  const handleLegacyDragStart = (kind: string) => {
    setPaletteDragSymbolKind(kind);
    interactionController.beginPlacement(kind);
  };
  const handleFamilyDragStart = (family: ComponentFamilyType) => {
    setPaletteDragSymbolKind(family.id);
    interactionController.beginPlacement(family.id);
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
              const families = groupedFamilies.get(category.key) ?? [];
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
                      family={family}
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
