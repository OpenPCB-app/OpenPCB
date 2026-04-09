import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type {
  CoreBackendModuleContext,
  CoreBackendModuleDefinition,
  ModuleLogger,
} from "../../../core/backend/runtime/modules/backend-module";
import type { ModuleRouter } from "../../../core/backend/runtime/router/module-router";
import knowledgeModule from "../ts/module";

type LegacyRouteHandler = (ctx: {
  req: Request;
  url: URL;
  query: URLSearchParams;
  params: { getOrThrow(name: string): string };
}) => Promise<Response> | Response;

interface LegacyHttpRouter {
  get(path: string, handler: LegacyRouteHandler): void;
  post(path: string, handler: LegacyRouteHandler): void;
  put(path: string, handler: LegacyRouteHandler): void;
  patch(path: string, handler: LegacyRouteHandler): void;
  delete(path: string, handler: LegacyRouteHandler): void;
}

interface LegacyWsRouter {
  on(_type: string, _handler: (...args: unknown[]) => unknown): void;
  off(_type: string, _handler: (...args: unknown[]) => unknown): void;
}

interface LegacyEventBus {
  on<T = unknown>(event: string, handler: (payload: T) => void | Promise<void>): void;
  off<T = unknown>(event: string, handler: (payload: T) => void | Promise<void>): void;
  emit<T = unknown>(event: string, payload: T): Promise<void>;
  clear(): void;
  listenerCount(event: string): number;
}

interface LegacyModuleDbHandle {
  getRawDb(): BunSQLiteDatabase<Record<string, unknown>>;
  query<T = unknown>(sqlTemplate: string, tableName: string, params?: unknown[]): Promise<T[]>;
  execute(sqlTemplate: string, tableName: string, params?: unknown[]): Promise<void>;
  createTable(tableName: string, columnDefinitions: string): Promise<void>;
  dropTable(tableName: string): Promise<void>;
  transaction<T>(fn: (handle: LegacyModuleDbHandle) => Promise<T>): Promise<T>;
}

interface LegacyModuleContext {
  moduleId: string;
  manifest: unknown;
  logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    log(...args: unknown[]): void;
  };
  events: LegacyEventBus;
  db: LegacyModuleDbHandle;
  mentions: {
    register(provider: unknown): void;
  };
  core: {
    contentEditor?: unknown;
    toolRegistry?: unknown;
    projects?: unknown;
  };
}

interface LegacyModuleDefinition {
  endpoints?: (ctx: LegacyModuleContext, http: LegacyHttpRouter, ws: LegacyWsRouter) => void;
  onActivate?: (ctx: LegacyModuleContext) => Promise<void> | void;
  onDeactivate?: (ctx: LegacyModuleContext) => Promise<void> | void;
}

class LocalEventBus implements LegacyEventBus {
  private readonly handlers = new Map<string, Set<(payload: unknown) => void | Promise<void>>>();

  on<T = unknown>(event: string, handler: (payload: T) => void | Promise<void>): void {
    const existing = this.handlers.get(event) ?? new Set();
    existing.add(handler as (payload: unknown) => void | Promise<void>);
    this.handlers.set(event, existing);
  }

  off<T = unknown>(event: string, handler: (payload: T) => void | Promise<void>): void {
    const existing = this.handlers.get(event);
    if (!existing) {
      return;
    }
    existing.delete(handler as (payload: unknown) => void | Promise<void>);
    if (existing.size === 0) {
      this.handlers.delete(event);
    }
  }

  async emit<T = unknown>(event: string, payload: T): Promise<void> {
    const existing = this.handlers.get(event);
    if (!existing || existing.size === 0) {
      return;
    }
    for (const handler of existing) {
      await handler(payload);
    }
  }

  clear(): void {
    this.handlers.clear();
  }

  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

class SqliteModuleDbHandle implements LegacyModuleDbHandle {
  constructor(
    private readonly moduleId: string,
    private readonly sqlite: Database,
    private readonly db: BunSQLiteDatabase<Record<string, unknown>>,
  ) {}

  private prefixedTable(tableName: string): string {
    return `module_${this.moduleId}_${tableName}`;
  }

  private renderSql(sqlTemplate: string, tableName: string): string {
    return sqlTemplate.replace(/\$table/g, this.prefixedTable(tableName));
  }

  async query<T = unknown>(
    sqlTemplate: string,
    tableName: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const sqlText = this.renderSql(sqlTemplate, tableName);
    const statement = this.sqlite.query(sqlText);
    return statement.all(...(params as [])) as T[];
  }

  async execute(
    sqlTemplate: string,
    tableName: string,
    params: unknown[] = [],
  ): Promise<void> {
    const sqlText = this.renderSql(sqlTemplate, tableName);
    const statement = this.sqlite.query(sqlText);
    statement.run(...(params as []));
  }

  async createTable(tableName: string, columnDefinitions: string): Promise<void> {
    const table = this.prefixedTable(tableName);
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS ${table} (${columnDefinitions})`);
  }

  async dropTable(tableName: string): Promise<void> {
    const table = this.prefixedTable(tableName);
    this.sqlite.exec(`DROP TABLE IF EXISTS ${table}`);
  }

  async transaction<T>(fn: (handle: LegacyModuleDbHandle) => Promise<T>): Promise<T> {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn(this);
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  getRawDb(): BunSQLiteDatabase<Record<string, unknown>> {
    return this.db;
  }
}

let cachedLegacyContext: LegacyModuleContext | null = null;
let cachedSqlite: Database | null = null;

function toLegacyLogger(logger: ModuleLogger): LegacyModuleContext["logger"] {
  const forward = (level: "info" | "warn" | "error", args: unknown[]) => {
    const [first, ...rest] = args;
    const message = typeof first === "string" ? first : JSON.stringify(first);
    const payload = rest.length === 0 ? undefined : rest;
    if (level === "info") {
      logger.info(message ?? "", payload);
      return;
    }
    if (level === "warn") {
      logger.warn(message ?? "", payload);
      return;
    }
    logger.error(message ?? "", payload);
  };

  return {
    info: (...args: unknown[]) => forward("info", args),
    warn: (...args: unknown[]) => forward("warn", args),
    error: (...args: unknown[]) => forward("error", args),
    debug: (...args: unknown[]) => logger.info("[debug]", args),
    log: (...args: unknown[]) => forward("info", args),
  };
}

function resolveKnowledgeDbFilePath(): string {
  const appDataDir = process.env.APP_DATA_DIR ?? path.join(process.cwd(), "data");
  mkdirSync(appDataDir, { recursive: true });
  return path.join(appDataDir, "OpenPCB.modules.db");
}

function createLegacyDbHandle(moduleId: string): LegacyModuleDbHandle {
  if (!cachedSqlite) {
    cachedSqlite = new Database(resolveKnowledgeDbFilePath(), {
      create: true,
      readwrite: true,
    });
    cachedSqlite.exec("PRAGMA journal_mode = WAL;");
    cachedSqlite.exec("PRAGMA busy_timeout = 5000;");
  }

  const db = drizzle(cachedSqlite) as BunSQLiteDatabase<Record<string, unknown>>;
  return new SqliteModuleDbHandle(moduleId, cachedSqlite, db);
}

function ensureLegacyContext(ctx: CoreBackendModuleContext): LegacyModuleContext {
  if (cachedLegacyContext) {
    return cachedLegacyContext;
  }

  cachedLegacyContext = {
    moduleId: ctx.moduleId,
    manifest: ctx.manifest,
    logger: toLegacyLogger(ctx.logger),
    events: new LocalEventBus(),
    db: createLegacyDbHandle(ctx.moduleId),
    mentions: {
      register: () => {
        // mention registration not wired in core runtime yet
      },
    },
    core: {},
  };
  return cachedLegacyContext;
}

function createLegacyHttpAdapter(router: ModuleRouter): LegacyHttpRouter {
  return {
    get: (pathName, handler) => router.get(pathName, async (routeCtx) => await handler(routeCtx)),
    post: (pathName, handler) =>
      router.post(pathName, async (routeCtx) => await handler(routeCtx)),
    put: (pathName, handler) => router.put(pathName, async (routeCtx) => await handler(routeCtx)),
    patch: (pathName, handler) =>
      router.patch(pathName, async (routeCtx) => await handler(routeCtx)),
    delete: (pathName, handler) =>
      router.delete(pathName, async (routeCtx) => await handler(routeCtx)),
  };
}

function createLegacyWsAdapter(): LegacyWsRouter {
  return {
    on: () => {
      // WebSocket bridge for module runtime not implemented in core yet
    },
    off: () => {
      // WebSocket bridge for module runtime not implemented in core yet
    },
  };
}

const legacyDefinition = knowledgeModule as unknown as LegacyModuleDefinition;

export const backendModule: CoreBackendModuleDefinition = {
  id: "knowledge",
  registerRoutes(router, ctx) {
    const legacyContext = ensureLegacyContext(ctx);
    if (!legacyDefinition.endpoints) {
      throw new Error("Legacy knowledge module has no endpoints registrar");
    }
    legacyDefinition.endpoints(
      legacyContext,
      createLegacyHttpAdapter(router),
      createLegacyWsAdapter(),
    );
  },
  async onActivate(ctx) {
    const legacyContext = ensureLegacyContext(ctx);
    if (!legacyDefinition.onActivate) {
      return;
    }
    await Promise.resolve(legacyDefinition.onActivate(legacyContext));
  },
  async onDeactivate(ctx) {
    const legacyContext = ensureLegacyContext(ctx);
    if (!legacyDefinition.onDeactivate) {
      return;
    }
    await Promise.resolve(legacyDefinition.onDeactivate(legacyContext));
  },
};

export default backendModule;
