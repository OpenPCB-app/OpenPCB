export type ToolMode = "select" | "place" | "wire" | "label";

export type DesignerView = "schem" | "pcb" | "3d" | "bom";

export interface ModuleSpaceProps {
  moduleId: string;
  namespace?: string;
  backendURL?: string | null;
}
