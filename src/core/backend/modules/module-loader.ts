import { access } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ModuleRegistryItem,
  ModuleRegistryResponse,
  ResolvedModuleDependency,
} from "../../contracts/modules/registry";
import type { NormalizedModuleManifest } from "../../contracts/modules/manifest";
import type { CoreBackendModuleContext } from "../../contracts/modules/backend-module";
import { ModuleRouter } from "../router/module-router";
import type { ModuleRouterRegistry } from "../router/module-registry";
import { createModuleDb } from "../db/module-db-factory";
import { createLogger } from "../logging/logger";
import { applyModuleMigrations } from "../migrations/module-migrator";
import {
  isCoreBackendModuleDefinition,
  type CoreBackendModuleDefinition,
} from "./backend-module";
import { discoverModuleManifests } from "./manifest-discovery";
import { RuntimeSdkRegistry } from "./sdk-registry";

interface ModuleLoadRecord {
  id: string;
  label: string;
  namespace: string;
  version: string;
  kind: NormalizedModuleManifest["kind"];
  sidebar: NormalizedModuleManifest["sidebar"];
  defaultPinned: boolean;
  status: "pending" | "loaded" | "skipped" | "failed";
  reason?: string;
  dependencies: ResolvedModuleDependency[];
}

interface LoadedRuntimeModule {
  manifest: NormalizedModuleManifest;
  definition: CoreBackendModuleDefinition;
  context: CoreBackendModuleContext;
}

export interface ModuleRuntimeDebugSnapshot {
  loadedModules: string[];
  modules: ModuleRegistryItem[];
  sdkTokens: string[];
}

export interface ModuleRuntimeSnapshotProvider {
  snapshot(): ModuleRegistryResponse;
  debugSnapshot(): ModuleRuntimeDebugSnapshot;
}

export interface ModuleLoaderOptions {
  moduleRegistry: ModuleRouterRegistry;
  workspaceRoot?: string;
  sdkRegistry?: RuntimeSdkRegistry;
}

const FALLBACK_SIDEBAR = {
  label: "",
  icon: "Box",
  order: 999,
} as const;

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(value: string): ParsedSemver | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    return null;
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    !Number.isInteger(patch)
  ) {
    return null;
  }
  return { major, minor, patch };
}

function isVersionAtLeast(actual: string, minVersion: string): boolean {
  const actualParsed = parseSemver(actual);
  const minParsed = parseSemver(minVersion);
  if (!actualParsed || !minParsed) {
    return false;
  }

  if (actualParsed.major !== minParsed.major) {
    return actualParsed.major > minParsed.major;
  }
  if (actualParsed.minor !== minParsed.minor) {
    return actualParsed.minor > minParsed.minor;
  }
  return actualParsed.patch >= minParsed.patch;
}

function hasModulesDirectory(workspaceRoot: string): boolean {
  return existsSync(path.join(workspaceRoot, "modules"));
}

function resolveWorkspaceRoot(options: ModuleLoaderOptions): string {
  const explicit = options.workspaceRoot ?? process.env.OPENPCB_WORKSPACE_ROOT;
  if (explicit) {
    return explicit;
  }

  const candidates = [
    path.resolve(import.meta.dir, "../../.."),
    path.resolve(process.cwd(), "src"),
    process.cwd(),
  ];

  for (const candidate of candidates) {
    if (hasModulesDirectory(candidate)) {
      return candidate;
    }
  }

  return candidates[0]!;
}

export class ModuleRuntime implements ModuleRuntimeSnapshotProvider {
  private readonly moduleRegistry: ModuleRouterRegistry;

  private readonly workspaceRoot: string;

  private readonly sdkRegistry: RuntimeSdkRegistry;

  private readonly records = new Map<string, ModuleLoadRecord>();

  private readonly loaded = new Map<string, LoadedRuntimeModule>();

  constructor(options: ModuleLoaderOptions) {
    this.moduleRegistry = options.moduleRegistry;
    this.workspaceRoot = resolveWorkspaceRoot(options);
    this.sdkRegistry = options.sdkRegistry ?? new RuntimeSdkRegistry();
  }

  getSdkRegistry(): RuntimeSdkRegistry {
    return this.sdkRegistry;
  }

  async bootstrap(): Promise<void> {
    this.records.clear();
    this.loaded.clear();

    const discovered = await discoverModuleManifests(this.workspaceRoot);
    const manifestById = new Map(
      discovered.manifests.map((entry) => [entry.manifest.id, entry]),
    );

    for (const entry of discovered.manifests) {
      this.records.set(entry.manifest.id, this.createRecord(entry.manifest));
    }
    for (const failure of discovered.failures) {
      this.records.set(failure.moduleId, {
        id: failure.moduleId,
        label: failure.moduleId,
        namespace: `invalid.${failure.moduleId}`,
        version: "0.0.0",
        kind: "space",
        sidebar: { ...FALLBACK_SIDEBAR, label: failure.moduleId },
        defaultPinned: false,
        status: "failed",
        reason: failure.reason,
        dependencies: [],
      });
    }

    const pending = new Set(manifestById.keys());

    while (pending.size > 0) {
      let progressed = false;

      for (const moduleId of [...pending]) {
        const discoveredManifest = manifestById.get(moduleId);
        if (!discoveredManifest) {
          pending.delete(moduleId);
          continue;
        }

        const manifest = discoveredManifest.manifest;
        const record = this.records.get(moduleId);
        if (!record) {
          pending.delete(moduleId);
          continue;
        }

        if (!manifest.enabled) {
          record.dependencies = this.resolveDependencies(manifest);
          record.status = "skipped";
          record.reason = "Disabled by manifest";
          pending.delete(moduleId);
          progressed = true;
          continue;
        }

        record.dependencies = this.resolveDependencies(manifest);
        const blocking = record.dependencies.find(
          (dep) =>
            !dep.optional &&
            ["missing", "failed", "skipped"].includes(dep.status),
        );
        if (blocking) {
          record.status = "skipped";
          record.reason = `Required dependency '${blocking.id}' is ${blocking.status}`;
          pending.delete(moduleId);
          progressed = true;
          continue;
        }

        const waitingRequired = record.dependencies.some(
          (dep) => !dep.optional && dep.status === "pending",
        );
        if (waitingRequired) {
          continue;
        }

        try {
          await this.loadSingleModule(discoveredManifest);
          record.status = "loaded";
          delete record.reason;
        } catch (error) {
          record.status = "failed";
          record.reason =
            error instanceof Error
              ? error.message
              : "Unknown module load error";
        }

        pending.delete(moduleId);
        progressed = true;
      }

      if (!progressed) {
        for (const moduleId of pending) {
          const record = this.records.get(moduleId);
          if (!record) {
            continue;
          }
          record.dependencies = record.dependencies.map((dep) =>
            dep.status === "pending"
              ? {
                  ...dep,
                  status: "skipped",
                }
              : dep,
          );
          record.status = "skipped";
          record.reason = "Dependency cycle or unresolved dependencies";
        }
        pending.clear();
      }
    }
  }

  snapshot(): ModuleRegistryResponse {
    const modules: ModuleRegistryItem[] = [...this.records.values()]
      .map((record) => ({
        id: record.id,
        label: record.label,
        namespace: record.namespace,
        version: record.version,
        kind: record.kind,
        sidebar: record.sidebar,
        defaultPinned: record.defaultPinned,
        status: record.status === "pending" ? "skipped" : record.status,
        reason: record.reason,
        dependencies: record.dependencies,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));

    return {
      modules,
      loadedModules: modules
        .filter((item) => item.status === "loaded")
        .map((item) => item.id),
    };
  }

  debugSnapshot(): ModuleRuntimeDebugSnapshot {
    const snapshot = this.snapshot();
    return {
      loadedModules: snapshot.loadedModules,
      modules: snapshot.modules,
      sdkTokens: this.sdkRegistry.listTokens(),
    };
  }

  private createRecord(manifest: NormalizedModuleManifest): ModuleLoadRecord {
    return {
      id: manifest.id,
      label: manifest.label,
      namespace: manifest.namespace,
      version: manifest.version,
      kind: manifest.kind,
      sidebar: manifest.sidebar,
      defaultPinned: manifest.defaultPinned,
      status: "pending",
      dependencies: [],
    };
  }

  private resolveDependencies(
    manifest: NormalizedModuleManifest,
  ): ResolvedModuleDependency[] {
    return manifest.dependsOn.map((dep) => {
      const record = this.records.get(dep.id);
      if (!record) {
        return {
          ...dep,
          optional: Boolean(dep.optional),
          status: "missing",
        };
      }

      const hasVersionMismatch =
        record.status === "loaded" &&
        typeof dep.minVersion === "string" &&
        dep.minVersion.trim().length > 0 &&
        !isVersionAtLeast(record.version, dep.minVersion);

      if (hasVersionMismatch) {
        return {
          ...dep,
          optional: Boolean(dep.optional),
          status: "failed",
        };
      }

      return {
        ...dep,
        optional: Boolean(dep.optional),
        status: record.status,
      };
    });
  }

  private async loadSingleModule(discoveredManifest: {
    manifest: NormalizedModuleManifest;
    moduleDir: string;
  }): Promise<void> {
    const manifest = discoveredManifest.manifest;

    // 1. Apply migrations BEFORE calling onActivate so the module's
    //    schema is ready when it runs its first query.
    const migrationsDir = path.join(
      discoveredManifest.moduleDir,
      "backend",
      "migrations",
    );
    const migrationReport = await applyModuleMigrations(
      manifest.id,
      migrationsDir,
    );
    if (migrationReport.failed) {
      throw new Error(
        `Migration '${migrationReport.failed.name}' failed: ${migrationReport.failed.error}`,
      );
    }

    // 2. Dynamic-import the backend barrel.
    const modulePath = await this.resolveBackendEntryPath(
      discoveredManifest.moduleDir,
      manifest,
    );
    const moduleUrl = pathToFileURL(modulePath).toString();
    const moduleExports = (await import(moduleUrl)) as Record<string, unknown>;
    const definitionCandidate =
      moduleExports.definition ??
      moduleExports.default ??
      moduleExports.backendModule;

    if (!isCoreBackendModuleDefinition(definitionCandidate)) {
      throw new Error(
        `Backend entry '${modulePath}' does not export a ModuleDefinition (expected 'definition' or default export)`,
      );
    }

    const definition = definitionCandidate as CoreBackendModuleDefinition;
    if (definition.id !== manifest.id) {
      throw new Error(
        `Backend entry id '${definition.id}' does not match manifest id '${manifest.id}'`,
      );
    }

    // 3. Build the ctx.
    const logger = createLogger(manifest.id);
    const db = createModuleDb(manifest.id);
    const context: CoreBackendModuleContext = {
      moduleId: manifest.id,
      manifest,
      sdk: this.sdkRegistry,
      logger,
      db,
    };

    if (migrationReport.applied.length > 0) {
      logger.info("applied migrations", {
        count: migrationReport.applied.length,
        names: migrationReport.applied,
      });
    }

    // 4. Run module lifecycle: onActivate → registerSdk → registerRoutes.
    if (definition.onActivate) {
      await Promise.resolve(definition.onActivate(context));
    }
    if (definition.registerSdk) {
      await Promise.resolve(definition.registerSdk(context));
    }

    const router = new ModuleRouter(manifest.id, definition.errorBoundary);
    if (definition.registerRoutes) {
      await Promise.resolve(definition.registerRoutes(router, context));
    }
    this.moduleRegistry.register(router);

    this.loaded.set(manifest.id, {
      manifest,
      definition,
      context,
    });
  }

  private async resolveBackendEntryPath(
    moduleDir: string,
    manifest: NormalizedModuleManifest,
  ): Promise<string> {
    const entry = manifest.runtime.backendEntry;
    const candidate = path.join(moduleDir, entry);
    try {
      await access(candidate);
      return candidate;
    } catch {
      throw new Error(`Backend entry not found: ${candidate}`);
    }
  }
}
