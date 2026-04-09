export type ModuleKind = "space" | "service" | "integration" | "widget" | "system";

export interface ModuleDependency {
  id: string;
  minVersion?: string;
  optional?: boolean;
}

export interface ModuleUiManifest {
  moduleEntry: string;
  primarySpace?: string;
  registerAsSpaceInTopBar?: boolean;
  sidebarLabel?: string;
}

export interface ModuleManifest {
  id: string;
  label: string;
  namespace: string;
  version: string;
  apiVersion: number;
  enabled?: boolean;
  kind?: ModuleKind;
  ui: ModuleUiManifest;
  runtime?: {
    backendEntry?: string;
    frontendEntry?: string;
  };
  dependsOn?: ModuleDependency[];
  dependencies?: string[];
  defaultPinned?: boolean;
}

export interface NormalizedModuleManifest {
  id: string;
  label: string;
  namespace: string;
  version: string;
  apiVersion: number;
  enabled: boolean;
  kind: ModuleKind;
  ui: ModuleUiManifest;
  runtime?: {
    backendEntry?: string;
    frontendEntry?: string;
  };
  dependsOn: ModuleDependency[];
  defaultPinned: boolean;
}
