import { readdir } from "node:fs/promises";
import path from "node:path";
import type {
  ModuleDependency,
  ModuleManifest,
  ModuleSidebarDeclaration,
  NormalizedModuleManifest,
} from "../../contracts/modules/manifest";

export interface DiscoveredManifest {
  manifest: NormalizedModuleManifest;
  moduleDir: string;
}

export interface ManifestFailure {
  moduleId: string;
  reason: string;
}

export interface ManifestDiscoveryResult {
  manifests: DiscoveredManifest[];
  failures: ManifestFailure[];
}

const MODULE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const MODULE_NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/;

const DEFAULT_BACKEND_ENTRY = "module.backend.ts";
const DEFAULT_FRONTEND_ENTRY = "module.frontend.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function normalizeDependencies(raw: ModuleManifest): ModuleDependency[] {
  if (!Array.isArray(raw.dependsOn)) {
    return [];
  }
  return raw.dependsOn
    .filter((dep) => dep && typeof dep.id === "string" && dep.id.length > 0)
    .map((dep) => ({
      id: dep.id,
      minVersion: dep.minVersion,
      optional: Boolean(dep.optional),
    }));
}

function normalizeSidebar(raw: ModuleManifest): ModuleSidebarDeclaration {
  const sidebar = raw.sidebar;
  if (!sidebar || typeof sidebar !== "object") {
    throw new Error("Manifest missing required 'sidebar' section");
  }
  if (typeof sidebar.label !== "string" || sidebar.label.length === 0) {
    throw new Error("sidebar.label must be a non-empty string");
  }
  if (typeof sidebar.icon !== "string" || sidebar.icon.length === 0) {
    throw new Error("sidebar.icon must be a Lucide icon name string");
  }
  if (typeof sidebar.order !== "number") {
    throw new Error("sidebar.order must be a number");
  }
  return {
    label: sidebar.label,
    icon: sidebar.icon,
    order: sidebar.order,
    group: typeof sidebar.group === "string" ? sidebar.group : undefined,
  };
}

function normalizeManifest(raw: ModuleManifest): NormalizedModuleManifest {
  if (!MODULE_ID_PATTERN.test(raw.id)) {
    throw new Error(`Invalid module id '${raw.id}'`);
  }
  if (!MODULE_NAMESPACE_PATTERN.test(raw.namespace)) {
    throw new Error(`Invalid namespace '${raw.namespace}'`);
  }
  if (raw.apiVersion !== 2) {
    throw new Error(`Unsupported apiVersion: ${raw.apiVersion}. Expected 2.`);
  }

  const sidebar = normalizeSidebar(raw);
  const runtime = {
    backendEntry: raw.runtime?.backendEntry ?? DEFAULT_BACKEND_ENTRY,
    frontendEntry: raw.runtime?.frontendEntry ?? DEFAULT_FRONTEND_ENTRY,
  };

  return {
    id: raw.id,
    label: raw.label,
    namespace: raw.namespace,
    version: raw.version,
    apiVersion: 2,
    enabled: raw.enabled !== false,
    kind: raw.kind ?? "space",
    sidebar,
    runtime,
    dependsOn: normalizeDependencies(raw),
    defaultPinned: Boolean(raw.defaultPinned),
  };
}

export async function discoverModuleManifests(
  workspaceRoot: string,
): Promise<ManifestDiscoveryResult> {
  const modulesRoot = path.join(workspaceRoot, "modules");
  const entries = await readdir(modulesRoot, { withFileTypes: true });
  const manifests: DiscoveredManifest[] = [];
  const failures: ManifestFailure[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) {
      continue;
    }

    const moduleDir = path.join(modulesRoot, entry.name);
    const manifestPath = path.join(moduleDir, "manifest.json");

    try {
      const file = Bun.file(manifestPath);
      if (!(await file.exists())) {
        failures.push({
          moduleId: entry.name,
          reason: "manifest.json missing",
        });
        continue;
      }

      const parsed = JSON.parse(await file.text()) as unknown;
      if (!isRecord(parsed)) {
        throw new Error("Manifest must be an object");
      }

      const normalized = normalizeManifest(parsed as unknown as ModuleManifest);
      manifests.push({ manifest: normalized, moduleDir });
    } catch (error) {
      failures.push({
        moduleId: entry.name,
        reason:
          error instanceof Error ? error.message : "Unknown manifest error",
      });
    }
  }

  manifests.sort((left, right) =>
    left.manifest.id.localeCompare(right.manifest.id),
  );
  failures.sort((left, right) => left.moduleId.localeCompare(right.moduleId));

  return { manifests, failures };
}
