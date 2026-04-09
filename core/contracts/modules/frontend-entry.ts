import type { ComponentType } from "react";

export interface FrontendModuleSpaceProps {
  moduleId: string;
  moduleLabel: string;
  namespace: string;
  backendURL: string | null;
}

export interface FrontendModuleEntry {
  id: string;
  Space: ComponentType<FrontendModuleSpaceProps>;
}
