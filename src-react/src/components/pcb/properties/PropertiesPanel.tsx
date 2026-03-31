import { ScrollArea } from "@/components/ui/scroll-area";
import { useSchematicStore } from "@/stores/schematic-store";

export function PropertiesPanel() {
  const selectedIds = useSchematicStore((s) => s.selectedEntityIds);
  const document = useSchematicStore((s) => s.document);

  if (selectedIds.size === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-center text-xs text-muted-foreground">
          Select an entity to view properties
        </p>
      </div>
    );
  }

  if (selectedIds.size > 1) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-center text-xs text-muted-foreground">
          {selectedIds.size} entities selected
        </p>
      </div>
    );
  }

  // Single selection
  const selectedId = [...selectedIds][0];
  const entity =
    document?.symbols.find((s) => s.id === selectedId) ??
    document?.wires.find((w) => w.id === selectedId) ??
    document?.labels.find((l) => l.id === selectedId);

  if (!entity) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-center text-xs text-muted-foreground">
          Entity not found
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-3">
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            Type
          </h3>
          <p className="text-sm capitalize">{entity.entityType}</p>
        </div>
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            Position
          </h3>
          <p className="font-mono text-sm">
            ({(entity.position.x / 1_000_000).toFixed(2)},{" "}
            {(entity.position.y / 1_000_000).toFixed(2)}) mm
          </p>
        </div>
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">
            Rotation
          </h3>
          <p className="text-sm">{entity.rotation}&deg;</p>
        </div>
        {entity.entityType === "symbol" && (
          <>
            <div>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                Reference
              </h3>
              <p className="text-sm">{entity.reference}</p>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                Value
              </h3>
              <p className="text-sm">{entity.value || "—"}</p>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                Symbol
              </h3>
              <p className="text-sm capitalize">
                {entity.symbolKind.replace(/_/g, " ")}
              </p>
            </div>
          </>
        )}
        {entity.entityType === "label" && (
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">
              Net Name
            </h3>
            <p className="text-sm">{entity.text}</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
