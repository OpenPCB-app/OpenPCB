import type { NormalizedModuleManifest } from "./manifest";

/**
 * Structural interface for the per-module database client. Concrete
 * implementation lives in `core/backend/db/module-db-factory.ts`. Modules
 * receive an instance of this via `ctx.db` and must not import the
 * concrete class.
 *
 * Note: this contract deliberately types `db` and the transaction tx as
 * `unknown` to avoid leaking a Drizzle dependency into the contracts layer.
 * Modules cast to their specific Drizzle client shape at the call site.
 */
export interface ModuleDbClient {
  readonly moduleId: string;
  readonly tablePrefix: string;
  readonly db: unknown;
  rawSql<T = unknown>(query: string, params?: unknown[]): T[];
  transaction<T>(fn: (tx: unknown) => T): T;
}

/** Structural logger interface. Implemented by core/backend/logging/logger.ts. */
export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

/**
 * Minimal SDK registry surface exposed to modules. Modules publish their
 * own SDK via `registerValue` during `registerSdk`, and consume other
 * modules' SDKs via the typed `get<T>` helper.
 */
export interface SdkRegistryHandle {
  has(token: string): boolean;
  get<T>(token: string): T | null;
  registerValue<T>(token: string, value: T): void;
}

/**
 * Context object passed into every lifecycle hook of a module's backend
 * definition (`onActivate`, `registerSdk`, `registerRoutes`).
 */
export interface CoreBackendModuleContext {
  moduleId: string;
  manifest: NormalizedModuleManifest;
  db: ModuleDbClient;
  sdk: SdkRegistryHandle;
  logger: Logger;
}

/**
 * Backend module definition exported by every module's `module.backend.ts`
 * barrel under the `definition` export.
 */
export interface ModuleDefinition {
  id: string;
  onActivate?: (ctx: CoreBackendModuleContext) => Promise<void> | void;
  onDeactivate?: (ctx: CoreBackendModuleContext) => Promise<void> | void;
  registerSdk?: (ctx: CoreBackendModuleContext) => Promise<void> | void;
  registerRoutes?: (
    router: ModuleRouterHandle,
    ctx: CoreBackendModuleContext,
  ) => Promise<void> | void;
}

/**
 * Minimal router surface exposed to modules. Prevents modules from
 * importing concrete router classes from core/backend internals.
 */
export interface ModuleRouterHandle {
  get(path: string, handler: ModuleRouteHandler): void;
  post(path: string, handler: ModuleRouteHandler): void;
  put(path: string, handler: ModuleRouteHandler): void;
  delete(path: string, handler: ModuleRouteHandler): void;
}

export type ModuleRouteHandler = (
  ctx: ModuleRouteContext,
) => Promise<Response> | Response;

export interface ModuleRouteContext {
  req: Request;
  query: URLSearchParams;
  params: {
    get(name: string): string | undefined;
    getOrThrow(name: string): string;
  };
}
