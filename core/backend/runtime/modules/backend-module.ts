import type { NormalizedModuleManifest } from "../../../contracts/modules/manifest";
import type { ProjectsCapability } from "../../../contracts/modules/capabilities";
import type { ModuleErrorBoundary } from "../router/module-types";
import type { ModuleRouter } from "../router/module-router";
import type { RuntimeSdkRegistry } from "./sdk-registry";
import type { CoreModuleDbHandle } from "./module-db-handle";

export interface ModuleLogger {
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export interface CoreBackendModuleContext {
  moduleId: string;
  manifest: NormalizedModuleManifest;
  sdk: RuntimeSdkRegistry;
  logger: ModuleLogger;
  db: CoreModuleDbHandle;
  core: {
    projects: ProjectsCapability;
  };
}

export interface CoreBackendModuleDefinition {
  id: string;
  registerRoutes?: (router: ModuleRouter, ctx: CoreBackendModuleContext) => Promise<void> | void;
  registerSdk?: (ctx: CoreBackendModuleContext) => Promise<void> | void;
  onActivate?: (ctx: CoreBackendModuleContext) => Promise<void> | void;
  onDeactivate?: (ctx: CoreBackendModuleContext) => Promise<void> | void;
  errorBoundary?: ModuleErrorBoundary;
}

export function isCoreBackendModuleDefinition(value: unknown): value is CoreBackendModuleDefinition {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<CoreBackendModuleDefinition>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    return false;
  }
  if (candidate.registerRoutes && typeof candidate.registerRoutes !== "function") {
    return false;
  }
  if (candidate.registerSdk && typeof candidate.registerSdk !== "function") {
    return false;
  }
  if (candidate.onActivate && typeof candidate.onActivate !== "function") {
    return false;
  }
  if (candidate.onDeactivate && typeof candidate.onDeactivate !== "function") {
    return false;
  }
  if (candidate.errorBoundary && typeof candidate.errorBoundary !== "function") {
    return false;
  }
  return true;
}

export class PrefixedModuleLogger implements ModuleLogger {
  constructor(private readonly moduleId: string) {}

  info(message: string, meta?: unknown): void {
    if (meta === undefined) {
      console.log(`[module:${this.moduleId}] ${message}`);
      return;
    }
    console.log(`[module:${this.moduleId}] ${message}`, meta);
  }

  warn(message: string, meta?: unknown): void {
    if (meta === undefined) {
      console.warn(`[module:${this.moduleId}] ${message}`);
      return;
    }
    console.warn(`[module:${this.moduleId}] ${message}`, meta);
  }

  error(message: string, meta?: unknown): void {
    if (meta === undefined) {
      console.error(`[module:${this.moduleId}] ${message}`);
      return;
    }
    console.error(`[module:${this.moduleId}] ${message}`, meta);
  }
}
