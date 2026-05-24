import type { ComponentType } from "react";
import type { ModuleManifest } from "./manifest";

/**
 * Props passed into a module's Space component by the host shell.
 * The host injects module identity and the resolved backend URL so the
 * Space doesn't need to fetch bootstrap info itself.
 */
export interface ModuleSpaceProps {
  moduleId: string;
  namespace: string;
  backendURL: string | null;
  designId?: string;
  params?: Record<string, string>;
}

/**
 * Default export shape of every module's `module.frontend.ts` barrel.
 *
 * - `manifest`: the module's manifest.json (imported directly by the barrel)
 * - `Space`: component rendered when the user navigates to the module
 */
export interface FrontendModuleEntry {
  manifest: ModuleManifest;
  Space: ComponentType<ModuleSpaceProps>;
}
