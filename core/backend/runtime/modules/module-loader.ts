import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ModuleRegistryItem,
  ModuleRegistryResponse,
  ResolvedModuleDependency,
} from "../../../contracts/modules/registry";
import { MODULE_SDK_TOKENS } from "../../../contracts/modules/sdk-map";
import type { NormalizedModuleManifest } from "../../../contracts/modules/manifest";
import { ModuleRouter } from "../router/module-router";
import type { ModuleRouterRegistry } from "../router/module-registry";
import {
  isCoreBackendModuleDefinition,
  PrefixedModuleLogger,
  type CoreBackendModuleContext,
  type CoreBackendModuleDefinition,
} from "./backend-module";
import { discoverModuleManifests } from "./manifest-discovery";
import { SqliteModuleDbHandle } from "./module-db-handle";
import { CoreProjectsCapability } from "./projects-capability";
import { RuntimeSdkRegistry } from "./sdk-registry";

interface ModuleLoadRecord {
  id: string;
  label: string;
  namespace: string;
  version: string;
  kind: NormalizedModuleManifest["kind"];
  registerAsSpaceInTopBar: boolean;
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

export class ModuleRuntime implements ModuleRuntimeSnapshotProvider {
  private readonly moduleRegistry: ModuleRouterRegistry;

  private readonly workspaceRoot: string;

  private readonly sdkRegistry: RuntimeSdkRegistry;

  private readonly records = new Map<string, ModuleLoadRecord>();

  private readonly loaded = new Map<string, LoadedRuntimeModule>();

  private readonly projectsCapability = new CoreProjectsCapability();

  constructor(options: ModuleLoaderOptions) {
    this.moduleRegistry = options.moduleRegistry;
    this.workspaceRoot =
      options.workspaceRoot ??
      process.env.OPENPCB_WORKSPACE_ROOT ??
      path.resolve(import.meta.dir, "../../../..");
    this.sdkRegistry = options.sdkRegistry ?? new RuntimeSdkRegistry();
    if (!this.sdkRegistry.has(MODULE_SDK_TOKENS.CORE_PROJECTS)) {
      this.sdkRegistry.registerValue(MODULE_SDK_TOKENS.CORE_PROJECTS, this.projectsCapability);
    }
  }

  getSdkRegistry(): RuntimeSdkRegistry {
    return this.sdkRegistry;
  }

  async bootstrap(): Promise<void> {
    this.records.clear();
    this.loaded.clear();

    const discovered = await discoverModuleManifests(this.workspaceRoot);
    const manifestById = new Map(discovered.manifests.map((entry) => [entry.manifest.id, entry]));

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
        registerAsSpaceInTopBar: false,
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
          (dep) => !dep.optional && ["missing", "failed", "skipped"].includes(dep.status),
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
          record.reason = error instanceof Error ? error.message : "Unknown module load error";
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
        registerAsSpaceInTopBar: record.registerAsSpaceInTopBar,
        defaultPinned: record.defaultPinned,
        status: record.status === "pending" ? "skipped" : record.status,
        reason: record.reason,
        dependencies: record.dependencies,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));

    return {
      modules,
      loadedModules: modules.filter((item) => item.status === "loaded").map((item) => item.id),
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
      registerAsSpaceInTopBar: Boolean(manifest.ui.registerAsSpaceInTopBar),
      defaultPinned: manifest.defaultPinned,
      status: "pending",
      dependencies: [],
    };
  }

  private resolveDependencies(manifest: NormalizedModuleManifest): ResolvedModuleDependency[] {
    return manifest.dependsOn.map((dep) => {
      const record = this.records.get(dep.id);
      if (!record) {
        return {
          ...dep,
          optional: Boolean(dep.optional),
          status: "missing",
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
    const modulePath = await this.resolveBackendEntryPath(discoveredManifest.moduleDir, manifest);
    const moduleUrl = pathToFileURL(modulePath).toString();
    const moduleExports = (await import(moduleUrl)) as Record<string, unknown>;
    const definitionCandidate =
      moduleExports.backendModule ?? moduleExports.default ?? moduleExports["module"];

    if (!isCoreBackendModuleDefinition(definitionCandidate)) {
      throw new Error(`Backend entry '${modulePath}' does not export CoreBackendModuleDefinition`);
    }

    const definition = definitionCandidate as CoreBackendModuleDefinition;
    if (definition.id !== manifest.id) {
      throw new Error(
        `Backend entry id '${definition.id}' does not match manifest id '${manifest.id}'`,
      );
    }

    const logger = new PrefixedModuleLogger(manifest.id);
    const context: CoreBackendModuleContext = {
      moduleId: manifest.id,
      manifest,
      sdk: this.sdkRegistry,
      logger,
      db: new SqliteModuleDbHandle(manifest.id),
      core: {
        projects: this.projectsCapability,
      },
    };

    const router = new ModuleRouter(manifest.id, definition.errorBoundary);
    if (definition.registerRoutes) {
      await Promise.resolve(definition.registerRoutes(router, context));
    }
    this.moduleRegistry.register(router);

    if (definition.registerSdk) {
      await Promise.resolve(definition.registerSdk(context));
    }
    if (definition.onActivate) {
      await Promise.resolve(definition.onActivate(context));
    }

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
    const explicitEntry = manifest.runtime?.backendEntry;
    const candidates = explicitEntry
      ? [path.join(moduleDir, explicitEntry)]
      : [
          path.join(moduleDir, "core", "backend-entry.ts"),
          path.join(moduleDir, "core", "backend-entry.tsx"),
          path.join(moduleDir, "core", "backend-entry.js"),
          path.join(moduleDir, "core", "backend-entry.mjs"),
        ];

    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // continue
      }
    }

    throw new Error(`Backend entry not found (${candidates.join(", ")})`);
  }
}
