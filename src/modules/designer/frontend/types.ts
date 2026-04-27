export type DesignerView = "schem" | "pcb" | "3d" | "bom";

export interface ModuleSpaceProps {
  moduleId: string;
  namespace?: string;
  backendURL?: string | null;
  designId?: string;
}

export const SCHEMATIC_GRID_MM = 0.5;
export const SCHEMATIC_GRID_NM = 500_000;
