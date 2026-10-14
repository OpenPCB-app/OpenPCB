export type DesignerView = "schem" | "pcb" | "3d" | "bom" | "drc";

export type ViewportState = { zoom: number; posX: number; posY: number };

export interface ModuleSpaceProps {
  moduleId: string;
  namespace?: string;
  backendURL?: string | null;
  designId?: string;
  params?: Record<string, string>;
}

// Application editing policy is independent of rendering-package visual defaults.
export {
  SCHEMATIC_GRID_MM,
  SCHEMATIC_GRID_NM,
} from "../../../shared/domain/editor-grid";
