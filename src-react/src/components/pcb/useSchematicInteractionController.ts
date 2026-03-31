import { useMemo } from "react";
import { useSchematicStore } from "@/stores/schematic-store";
import type { Point, SymbolKind, ToolMode } from "./types";

export interface SchematicInteractionController {
  activateTool: (tool: ToolMode) => void;
  beginPlacement: (kind: SymbolKind) => void;
  updatePlacementPreview: (position: Point | null) => void;
  commitPlacement: (position: Point) => void;
  rotatePlacement: () => void;
  beginWire: (sourcePinId: string) => void;
  updateWirePreview: (points: Point[], targetPinId?: string | null) => void;
  commitWire: (targetPinId: string) => boolean;
  cancelSession: () => void;
}

export function useSchematicInteractionController(): SchematicInteractionController {
  const activateTool = useSchematicStore((state) => state.activateTool);
  const beginPlacement = useSchematicStore((state) => state.beginPlacement);
  const updatePlacementPreview = useSchematicStore(
    (state) => state.setPlacementPreview,
  );
  const commitPlacement = useSchematicStore((state) => state.commitPlacement);
  const rotatePlacement = useSchematicStore((state) => state.rotatePlacement);
  const beginWire = useSchematicStore((state) => state.beginWire);
  const updateWirePreview = useSchematicStore(
    (state) => state.updateWirePreview,
  );
  const commitWire = useSchematicStore((state) => state.commitWire);
  const cancelSession = useSchematicStore((state) => state.cancelSession);

  return useMemo(
    () => ({
      activateTool,
      beginPlacement,
      updatePlacementPreview,
      commitPlacement,
      rotatePlacement,
      beginWire,
      updateWirePreview,
      commitWire,
      cancelSession,
    }),
    [
      activateTool,
      beginPlacement,
      updatePlacementPreview,
      commitPlacement,
      rotatePlacement,
      beginWire,
      updateWirePreview,
      commitWire,
      cancelSession,
    ],
  );
}
