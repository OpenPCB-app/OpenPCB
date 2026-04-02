/**
 * ModuleLoader - Discover, load, and initialize modules
 * Scans modules directory, imports module definitions, and registers endpoints
 */

import path from "path";
import { Glob } from "bun";
import { EventBus } from "./EventBus";
import { Logger } from "./Logger";
import {
  createModuleContext,
  type ModuleManifest,
  type ModuleContext,
} from "./ModuleContext";
import {
  ModuleRouter,
  moduleRouterRegistry,
} from "../transport/http/ModuleRouter";
import { WsRouter } from "../transport/ws/WsRouter";
import { WsManager } from "../transport/ws/WsManager";
import type { ModuleDefinitionV2, MentionRegistration, ContentTarget as ModuleContentTarget } from "shared/types";
import type { ModuleCoreCapability } from "shared/types";
import type { DatabaseAccess } from "../db";
import { withTimeout, DEFAULT_TIMEOUTS } from "../core/utils/timeout";
import { MentionRegistry } from "../domain/services/mention-registry";
import { DEFAULT_WORKSPACE_ID } from "../domain/constants";
import type { Project } from "../db/schema/project";
import type { ProjectRecord } from "shared/types";
import type { ContentTargetRegistry } from "../domain/services/content-editor/content-target-registry";
import type { ContentTarget as DomainContentTarget } from "../domain/services/content-editor/content-target.interface";
import type {
  ToolRegistry,
  RegisterToolFunction,
} from "../domain/services/tools/tool-registry";

/**
 * Loaded module metadata
 */
interface LoadedModule {
  id: string;
  manifest: ModuleManifest;
  definition: ModuleDefinitionV2;
  context: ModuleContext;
  httpRouter: ModuleRouter;
  wsRouter: WsRouter;
  wsManager: WsManager;
}

const DEFAULT_CORE_CAPABILITIES: ModuleCoreCapability[] = [
  "projects",
  "contentEditor",
  "toolRegistry",
];

/**
 * Module loader - manages module lifecycle
 */
export class ModuleLoader {
  private modules = new Map<string, LoadedModule>();
  private moduleDisposers = new Map<string, Array<() => void>>();
  private repoRoot: string;
  private db: DatabaseAccess;
  private contentTargetRegistry?: ContentTargetRegistry;
  private toolRegistry?: ToolRegistry;

  constructor(repoRoot: string, db: DatabaseAccess) {
    this.repoRoot = repoRoot;
    this.db = db;
  }

  /**
   * Set the content target registry for module integration
   */
  setContentTargetRegistry(registry: ContentTargetRegistry): void {
    this.contentTargetRegistry = registry;
  }

  /**
   * Set the tool registry for module tool registrations
   */
  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }

  /**
   * Get the configured tool registry
   */
  getToolRegistry(): ToolRegistry | undefined {
    return this.toolRegistry;
  }

  private isDomainContentTarget(target: ModuleContentTarget): target is DomainContentTarget {
    if (!target || typeof target !== "object") {
      return false;
    }

    const candidate = target as Partial<DomainContentTarget>;
    return (
      typeof candidate.targetType === "string" &&
      typeof candidate.label === "string" &&
      Array.isArray(candidate.supportedModes) &&
      typeof candidate.exists === "function" &&
      typeof candidate.getContent === "function" &&
      typeof candidate.getContentContext === "function" &&
      typeof candidate.setContent === "function" &&
      typeof candidate.applySelectionUpdate === "function"
    );
  }

  private toProjectRecord(project: Project): ProjectRecord {
    return {
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      deletedAt: project.deletedAt ? project.deletedAt.toISOString() : null,
    };
  }

  private resolveCoreCapabilities(
    manifest: ModuleManifest,
    logger: Logger,
  ): Set<ModuleCoreCapability> {
    const declared = manifest.coreCapabilities;
    if (!declared || declared.length === 0) {
      logger.warn(
        "Manifest missing coreCapabilities; defaulting to full core capability set",
      );
      return new Set(DEFAULT_CORE_CAPABILITIES);
    }

    const allowed = new Set(DEFAULT_CORE_CAPABILITIES);
    const unknown = declared.filter((cap) => !allowed.has(cap));
    if (unknown.length > 0) {
      logger.warn(
        `Ignoring unknown core capabilities: ${unknown.join(", ")}`,
      );
    }

    return new Set(declared.filter((cap) => allowed.has(cap)));
  }

  private createScopedDbHandle(
    moduleId: string,
    manifest: ModuleManifest,
    dbHandle: ModuleContext["db"],
    logger: Logger,
  ): ModuleContext["db"] {
    const allowRawAccess = manifest.db?.rawAccess !== false;
    if (allowRawAccess) {
      return dbHandle;
    }

    logger.info("Raw DB access disabled by manifest (db.rawAccess=false)");
    return {
      getRawDb: () => {
        throw new Error(
          `Module '${moduleId}' has db.rawAccess=false; raw db access is disabled`,
        );
      },
      query: (sqlTemplate, tableName, params) =>
        dbHandle.query(sqlTemplate, tableName, params),
      execute: (sqlTemplate, tableName, params) =>
        dbHandle.execute(sqlTemplate, tableName, params),
      createTable: (tableName, columnDefinitions) =>
        dbHandle.createTable(tableName, columnDefinitions),
      dropTable: (tableName) => dbHandle.dropTable(tableName),
      transaction: (fn, options) => dbHandle.transaction(fn, options),
    };
  }

  /**
   * Load all modules from modules directory
   */
  async loadAll(): Promise<void> {
    console.log("[ModuleLoader] Scanning for modules...");

    // Find all manifest.json files using Bun's Glob
    const manifestPattern = path.join(this.repoRoot, "modules/*/manifest.json");
    const glob = new Glob(manifestPattern);
    const manifestPaths: string[] = [];
    for await (const file of glob.scan(".")) {
      manifestPaths.push(path.resolve(file));
    }

    console.log(`[ModuleLoader] Found ${manifestPaths.length} modules`);

    // Load each module
    for (const manifestPath of manifestPaths) {
      try {
        await this.loadModule(manifestPath);
      } catch (error) {
        console.error(
          `[ModuleLoader] Failed to load module from ${manifestPath}:`,
          error,
        );
      }
    }

    console.log(
      `[ModuleLoader] Successfully loaded ${this.modules.size} modules`,
    );
  }

  /**
   * Load a single module
   */
  private async loadModule(manifestPath: string): Promise<void> {
    // Read manifest
    const manifestFile = Bun.file(manifestPath);
    const manifestText = await manifestFile.text();
    const manifest: ModuleManifest = JSON.parse(manifestText);

    const moduleId = manifest.id;
    console.log(`[ModuleLoader] Loading module: ${moduleId}`);

    // Import module definition
    const moduleDir = path.dirname(manifestPath);
    const modulePath = path.join(moduleDir, "ts", "module.ts");

    // Check if module file exists
    const moduleFile = Bun.file(modulePath);
    const exists = await moduleFile.exists();
    if (!exists) {
      console.warn(`[ModuleLoader] Module file not found: ${modulePath}`);
      return;
    }

    // Dynamic import
    const moduleExports = await import(modulePath);
    const definition: ModuleDefinitionV2 = moduleExports.default;

    if (!definition) {
      console.warn(`[ModuleLoader] Module ${moduleId} has no default export`);
      return;
    }

    // Create module infrastructure
    const logger = new Logger(`module:${moduleId}`);
    const events = new EventBus();
    const dbHandle = this.db.getModuleHandle(moduleId);
    const scopedDbHandle = this.createScopedDbHandle(
      moduleId,
      manifest,
      dbHandle,
      logger,
    );
    const mentionRegistry = MentionRegistry.get();
    const mentions: MentionRegistration = {
      register: (provider) => mentionRegistry.register(provider),
    };
    const contentTargetRegistry = this.contentTargetRegistry;
    const toolRegistry = this.toolRegistry;
    const registerTool: RegisterToolFunction | undefined = toolRegistry
      ? (definition, handler, options) => {
          const dispose = toolRegistry.register(definition, handler, {
            ...options,
            moduleId,
          });
          if (!this.moduleDisposers.has(moduleId)) {
            this.moduleDisposers.set(moduleId, []);
          }
          this.moduleDisposers.get(moduleId)!.push(dispose);
          return dispose;
        }
      : undefined;
    const capabilities = this.resolveCoreCapabilities(manifest, logger);
    const core: ModuleContext["core"] = {};

    if (capabilities.has("projects")) {
      core.projects = {
        list: async () => {
          const projects = await this.db.projects.findByWorkspace(
            DEFAULT_WORKSPACE_ID,
          );
          return projects.map((project) => this.toProjectRecord(project));
        },
        get: async (id: string) => {
          const project = await this.db.projects.findById(id);
          return project ? this.toProjectRecord(project) : null;
        },
        current: () => null,
      };
    }

    if (capabilities.has("contentEditor")) {
      if (!contentTargetRegistry) {
        logger.warn(
          "Module requested contentEditor capability, but content registry is unavailable",
        );
      } else {
        core.contentEditor = {
          registerTarget: (target: ModuleContentTarget) => {
            if (!this.isDomainContentTarget(target)) {
              throw new Error("Invalid content target registration");
            }
            contentTargetRegistry.register(target);
          },
          unregisterTarget: (targetType: string) => {
            contentTargetRegistry.unregister(targetType);
          },
        };
      }
    }

    if (capabilities.has("toolRegistry")) {
      if (!registerTool) {
        logger.warn(
          "Module requested toolRegistry capability, but tool registry is unavailable",
        );
      } else {
        core.toolRegistry = {
          registerTool,
        };
      }
    }

    const context = createModuleContext(
      moduleId,
      manifest,
      logger,
      events,
      scopedDbHandle,
      mentions,
      core,
    );

    const httpRouter = new ModuleRouter(moduleId);
    const wsRouter = new WsRouter(moduleId);
    const wsManager = new WsManager(moduleId, wsRouter);

    // Register endpoints if defined
    if (definition.endpoints) {
      logger.info("Registering endpoints...");
      try {
        const routesBefore = httpRouter.getRoutes().size;
        definition.endpoints(context, httpRouter, wsRouter);
        const routesAfter = httpRouter.getRoutes().size;

        if (routesAfter === routesBefore) {
          logger.warn("Module registered no HTTP routes");
        } else {
          logger.info(
            `Module registered ${routesAfter - routesBefore} HTTP routes`,
          );
        }
      } catch (error) {
        logger.error("Failed to register endpoints:", error);
        throw error;
      }
    }

    // Register routers globally
    moduleRouterRegistry.register(moduleId, httpRouter);

    // Store loaded module
    this.modules.set(moduleId, {
      id: moduleId,
      manifest,
      definition,
      context,
      httpRouter,
      wsRouter,
      wsManager,
    });

    // Call onActivate lifecycle hook
    if (definition.onActivate) {
      logger.info("Activating module...");
      try {
        await withTimeout(
          Promise.resolve(definition.onActivate(context)),
          DEFAULT_TIMEOUTS.LIFECYCLE,
          `Module ${moduleId} onActivate`,
        );
      } catch (error) {
        logger.error("Failed to activate module:", error);
        throw error;
      }
    }

    logger.info("Module loaded successfully");
  }

  /**
   * Get a loaded module by ID
   */
  getModule(moduleId: string): LoadedModule | undefined {
    return this.modules.get(moduleId);
  }

  /**
   * Get all loaded module IDs
   */
  getModuleIds(): string[] {
    return Array.from(this.modules.keys());
  }

  /**
   * Get WebSocket manager for a module
   */
  getWsManager(moduleId: string): WsManager | undefined {
    return this.modules.get(moduleId)?.wsManager;
  }

  /**
   * Unload a module
   */
  async unloadModule(moduleId: string): Promise<void> {
    const module = this.modules.get(moduleId);
    if (!module) {
      return;
    }

    module.context.logger.info("Unloading module...");

    // Clean up registered tools
    const disposers = this.moduleDisposers.get(moduleId) ?? [];
    for (const dispose of disposers) {
      try {
        dispose();
      } catch (error) {
        module.context.logger.error("Failed to dispose tool:", error);
      }
    }
    this.moduleDisposers.delete(moduleId);

    // Call onDeactivate lifecycle hook
    if (module.definition.onDeactivate) {
      try {
        await withTimeout(
          Promise.resolve(module.definition.onDeactivate(module.context)),
          DEFAULT_TIMEOUTS.LIFECYCLE,
          `Module ${moduleId} onDeactivate`,
        );
      } catch (error) {
        module.context.logger.error("Failed to deactivate module:", error);
      }
    }

    // Clean up WebSocket connections
    module.wsManager.closeAll();

    // Unregister routers
    moduleRouterRegistry.unregister(moduleId);

    // Clear event listeners
    module.context.events.clear();

    // Remove from loaded modules
    this.modules.delete(moduleId);

    module.context.logger.info("Module unloaded");
  }

  /**
   * Unload all modules
   */
  async unloadAll(): Promise<void> {
    const moduleIds = Array.from(this.modules.keys());
    for (const moduleId of moduleIds) {
      await this.unloadModule(moduleId);
    }
  }
}
