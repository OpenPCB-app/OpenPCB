export type DesignerView = "schem" | "pcb" | "3d" | "bom" | "drc";

export type ViewportState = { zoom: number; posX: number; posY: number };

export interface ModuleSpaceProps {
  moduleId: string;
  namespace?: string;
  backendURL?: string | null;
  designId?: string;
  params?: Record<string, string>;
}

// Re-exported from the shared canvas-defaults module so all canvases share
// one source of truth. Numerically identical to the previous local constants.
export {
  SCHEMATIC_GRID_MM,
  SCHEMATIC_GRID_NM,
} from "../../../shared/frontend/canvas/defaults";
