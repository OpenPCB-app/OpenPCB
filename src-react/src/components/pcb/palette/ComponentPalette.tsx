import { GripVertical } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useSchematicStore } from "@/stores/schematic-store";
import { PALETTE_SYMBOL_KIND_MIME } from "../symbol-library";
import {
  DESIGNER_COMPONENTS,
  SYMBOL_CATEGORIES,
  getSymbolKindLabel,
} from "../symbol-display";
import {
  useSchematicInteractionController,
  type SchematicInteractionController,
} from "../useSchematicInteractionController";

interface ComponentPaletteProps {
  controller?: SchematicInteractionController;
}

export function ComponentPalette({ controller }: ComponentPaletteProps) {
  const fallbackController = useSchematicInteractionController();
  const interactionController = controller ?? fallbackController;
  const session = useSchematicStore((s) => s.session);
  const draggedSymbolKind = useSchematicStore((s) => s.draggedSymbolKind);
  const setPaletteDragSymbolKind = useSchematicStore(
    (s) => s.setPaletteDragSymbolKind,
  );
  const activeSymbolKind =
    session?.type === "placement" ? session.symbolKind : draggedSymbolKind;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border-default px-3 py-2">
        <p className="text-[10px] font-medium tracking-wider text-text-secondary uppercase">
          Drag To Canvas
        </p>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2">
          {SYMBOL_CATEGORIES.map((category) => {
            const components = DESIGNER_COMPONENTS.filter(
              (c) => c.category === category.key,
            );
            if (components.length === 0) return null;
            return (
              <div key={category.key} className="mb-1">
                <div className="px-1 py-1.5">
                  <span className="text-[9px] font-semibold tracking-widest text-text-muted uppercase">
                    {category.label}
                  </span>
                </div>
                {components.map((component) => (
                  <Button
                    key={component.kind}
                    type="button"
                    variant={
                      activeSymbolKind === component.kind ? "default" : "ghost"
                    }
                    size="sm"
                    draggable
                    className="h-auto w-full items-start justify-start gap-3 px-3 py-2 text-left"
                    onDragStart={(event) => {
                      setPaletteDragSymbolKind(component.kind);
                      event.dataTransfer.effectAllowed = "copy";
                      event.dataTransfer.setData(
                        PALETTE_SYMBOL_KIND_MIME,
                        component.kind,
                      );
                      event.dataTransfer.setData("text/plain", component.kind);
                      interactionController.beginPlacement(component.kind);
                    }}
                    onDragEnd={() => {
                      setPaletteDragSymbolKind(null);
                      interactionController.cancelSession();
                    }}
                  >
                    <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-xs font-medium">
                        {getSymbolKindLabel(component.kind)}
                      </span>
                    </span>
                    {component.badge ? (
                      <span className="rounded border border-border-default px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                        {component.badge}
                      </span>
                    ) : null}
                  </Button>
                ))}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
