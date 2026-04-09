import type { PointNm } from "../../../backend/designer/contracts/geometry";

export type ToolMode = "select" | "place" | "wire";

export interface SchematicSessionState {
  activeTool: ToolMode;
  placementPreview: PointNm | null;
  wirePreview: PointNm[];
  viewport: {
    offsetX: number;
    offsetY: number;
    zoom: number;
  };
}

export function createInitialSchematicSessionState(): SchematicSessionState {
  return {
    activeTool: "select",
    placementPreview: null,
    wirePreview: [],
    viewport: {
      offsetX: 0,
      offsetY: 0,
      zoom: 1,
    },
  };
}
