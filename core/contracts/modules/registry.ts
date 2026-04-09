import type { ModuleDependency, ModuleKind } from "./manifest";

export type ModuleLoadStatus = "loaded" | "skipped" | "failed";

export interface ResolvedModuleDependency extends ModuleDependency {
  status: "loaded" | "missing" | "skipped" | "failed" | "pending";
}

export interface ModuleRegistryItem {
  id: string;
  label: string;
  sidebarLabel?: string;
  namespace: string;
  version: string;
  kind: ModuleKind;
  registerAsSpaceInTopBar: boolean;
  defaultPinned: boolean;
  status: ModuleLoadStatus;
  reason?: string;
  dependencies: ResolvedModuleDependency[];
}

export interface ModuleRegistryResponse {
  modules: ModuleRegistryItem[];
  loadedModules: string[];
}
