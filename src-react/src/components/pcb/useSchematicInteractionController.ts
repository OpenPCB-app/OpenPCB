import { useMemo } from "react";
import { useSchematicStore } from "@/stores/schematic-store";
import type { Point, SymbolKind, ToolMode } from "./types";

export interface SchematicInteractionController {
  activateTool: (tool: ToolMode) => void;
  beginPlacement: (kind: SymbolKind) => void;
  updatePlacementPreview: (position: Point | null) => void;
  rotatePlacement: () => void;
  beginWire: (sourcePinId: string) => void;
  updateWirePreview: (points: Point[], targetPinId?: string | null) => void;
  cancelSession: () => void;
}

export function useSchematicInteractionController(): SchematicInteractionController {
  const activateTool = useSchematicStore((state) => state.activateTool);
  const beginPlacement = useSchematicStore((state) => state.beginPlacement);
  const updatePlacementPreview = useSchematicStore(
    (state) => state.setPlacementPreview,
  );
  const rotatePlacement = useSchematicStore((state) => state.rotatePlacement);
  const beginWire = useSchematicStore((state) => state.beginWire);
  const updateWirePreview = useSchematicStore(
    (state) => state.updateWirePreview,
  );
  const cancelSession = useSchematicStore((state) => state.cancelSession);

  return useMemo(
    () => ({
      activateTool,
      beginPlacement,
      updatePlacementPreview,
      rotatePlacement,
      beginWire,
      updateWirePreview,
      cancelSession,
    }),
    [
      activateTool,
      beginPlacement,
      updatePlacementPreview,
      rotatePlacement,
      beginWire,
      updateWirePreview,
      cancelSession,
    ],
  );
}
