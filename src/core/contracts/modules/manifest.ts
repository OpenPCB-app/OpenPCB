/**
 * Module manifest contract.
 *
 * Each module ships a `manifest.json` at its root conforming to this shape.
 * The loader uses it to resolve sidebar presentation, boot order, and the
 * backend/frontend entry barrels.
 */

export type ModuleKind = "space" | "tool";

export interface ModuleDependency {
  id: string;
  minVersion?: string;
  optional?: boolean;
}

export interface ModuleSidebarDeclaration {
  /** Display label shown under the icon. */
  label: string;
  /** Lucide icon name, resolved at runtime (e.g. "Box", "PenTool"). */
  icon: string;
  /** Numeric sort order — lower values render first. */
  order: number;
  /** Optional grouping key for sidebar sections. */
  group?: string;
}

export interface ModuleRuntimeEntries {
  /** Relative path from module root to the backend barrel. Default: "module.backend.ts". */
  backendEntry?: string;
  /** Relative path from module root to the frontend barrel. Default: "module.frontend.ts". */
  frontendEntry?: string;
}

export interface ModuleManifest {
  id: string;
  label: string;
  version: string;
  apiVersion: 2;
  namespace: string;
  kind?: ModuleKind;
  enabled?: boolean;

  sidebar: ModuleSidebarDeclaration;
  runtime?: ModuleRuntimeEntries;
  dependsOn?: ModuleDependency[];
  defaultPinned?: boolean;
}

/**
 * Normalized manifest used internally after validation and defaulting.
 * Guarantees all runtime-relevant fields are populated.
 */
export interface NormalizedModuleManifest {
  id: string;
  label: string;
  version: string;
  apiVersion: 2;
  namespace: string;
  kind: ModuleKind;
  enabled: boolean;
  sidebar: ModuleSidebarDeclaration;
  runtime: Required<ModuleRuntimeEntries>;
  dependsOn: ModuleDependency[];
  defaultPinned: boolean;
}
