/**
 * Bun TypeScript Sidecar
 * HTTP server with module endpoint routing
 *
 * Bun version >=1.3.0 is required to run this code.
 */

import {
  corsPreflightResponse,
  isTrustedOrigin,
  withCorsHeaders,
} from "./transport/http/helpers";
import { moduleRouterRegistry } from "./transport/http/ModuleRouter";
import { ModuleLoader } from "./modules/ModuleLoader";
import path from "path";
import { initializeDatabase, DatabaseAccess } from "./db";
import { runMigrationsIfNeeded } from "./db/migrate";
import { ComponentFamilyService } from "./domain/services/component-family-service";
import { initializeKernel } from "./kernel/init";
import { setupDIContainer } from "./core/di/setup";
import { TOKENS } from "./core/di/container";
import { CoreRouter } from "./transport/router/core-router";
import { getProviderRegistry } from "./infrastructure/ai-providers/registry";
import type { ProviderId } from "@shared/types";
import { createProviderResolver } from "./domain/services/provider-resolver";
import { initializeTaskManager, taskManager } from "./kernel/tasks/instance";
import { TaskRepository } from "./db/repositories/task";
import { TaskStore } from "./kernel/tasks/store";
import { ResponseBuilder } from "./core/utils/response-builder";
import {
  initializeTaskOrchestrator,
  getTaskOrchestrator,
} from "./domain/services/queue/task-orchestrator";
import { initializeMessageService } from "./domain/services/message-service";
import { ToolDispatcher } from "./domain/services/tools/tool-dispatcher";
import {
  createEditContentHandler,
  editContentToolSpec,
} from "./domain/services/tools/edit-content-tool";
import {
  createFormatContentHandler,
  formatContentToolSpec,
} from "./domain/services/tools/format-content-tool";
import * as coreTools from "./domain/services/tools/core";
import {
  createProviderApiKeyStore,
  hydrateProviderRegistryFromStore,
} from "./infrastructure/ai-providers/api-key-store";
import { MentionRegistry } from "./domain/services/mention-registry";

import { timingSafeEqual } from "crypto";
import { initializeLogBuffer } from "./infrastructure/logging/log-buffer";
import { LicenseUtil } from "./domain/services/license-util";
import { ProviderOAuthRepository } from "./db/repositories/provider-oauth";
import { OAuthService } from "./infrastructure/oauth/oauth-service";
import type { OAuthProvider } from "./infrastructure/oauth/types";
import { QueryLogger } from "./db/query-logger";
import { createOAuthCleanup } from "./infrastructure/oauth/cleanup";

const STARTUP_LICENSE_STATES = [
  "active",
  "grace",
  "restricted",
  "blocked",
] as const;

type StartupLicenseState = (typeof STARTUP_LICENSE_STATES)[number];

const resolveStartupContractVersion = (): number => {
  const raw = process.env.OPENPCB_STARTUP_CONTRACT_VERSION;
  const parsed = Number(raw ?? "1");
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
};

const resolveStartupLicenseState = (): StartupLicenseState => {
  if (process.env.NODE_ENV === "development") {
    return "active";
  }
  const raw = process.env.OPENPCB_STARTUP_LICENSE_STATE;
  if (raw && STARTUP_LICENSE_STATES.includes(raw as StartupLicenseState)) {
    return raw as StartupLicenseState;
  }
  return "blocked";
};

const resolveStartupLicenseCode = (): string => {
  if (process.env.NODE_ENV === "development") {
    return "DEV_MODE_BYPASS";
  }
  const raw = process.env.OPENPCB_STARTUP_LICENSE_CODE;
  if (raw && raw.length > 0) {
    return raw;
  }
  return "STARTUP_LICENSE_MISSING";
};

// =============================================================================
// Global Error Handlers (catch startup crashes before they silently kill process)
// =============================================================================

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason);
  process.exit(1);
});

// =============================================================================
// Initialize Log Buffer (capture console logs early)
// =============================================================================

initializeLogBuffer();

// =============================================================================
// Configuration
// =============================================================================

const PORT = parseInt(process.env.PORT || "0", 10);
const HOST = process.env.HOST || "127.0.0.1";
const NODE_ENV = process.env.NODE_ENV || "development";
const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const APP_DATA_DIR = process.env.APP_DATA_DIR || path.join(REPO_ROOT, "data");
const WEB_DIST_DIR = path.join(REPO_ROOT, "src-react", "dist");
const ALLOW_UNAUTHENTICATED_API =
  process.env.OPENPCB_ALLOW_UNAUTHENTICATED_API === "true";
const STARTUP_CONTRACT_VERSION = resolveStartupContractVersion();
const STARTUP_LICENSE_STATE = resolveStartupLicenseState();
const STARTUP_LICENSE_CODE = resolveStartupLicenseCode();
const HAS_WEB_DIST = await Bun.file(
  path.join(WEB_DIST_DIR, "index.html"),
).exists();

function resolveStaticAssetPath(pathname: string): string | null {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const normalized = path.normalize(requestedPath).replace(/^\.+/, "");
  const absolutePath = path.join(WEB_DIST_DIR, normalized);
  if (!absolutePath.startsWith(WEB_DIST_DIR)) {
    return null;
  }
  return absolutePath;
}

// =============================================================================
// Database Initialization
// =============================================================================

console.log("[Database] Initializing database...");
const db = initializeDatabase({
  filePath: path.join(APP_DATA_DIR, "OpenPCB.db"),
  logger: NODE_ENV === "development",
});

//Run migrations if needed
await runMigrationsIfNeeded();

const componentFamilyService = new ComponentFamilyService(db.componentFamilies);
await componentFamilyService.seedBuiltIns();

console.log("[Database] Database ready");

// =============================================================================
// Kernel Initialization
// =============================================================================

await initializeKernel();

// =============================================================================
// Task System Initialization (SQLite Persistence)
// =============================================================================

console.log("[Tasks] Initializing task system with SQLite...");
const taskRepository = new TaskRepository(
  DatabaseAccess.getInstance().getDb(),
  DatabaseAccess.getInstance().getLogger(),
);
const taskStore = new TaskStore(taskRepository);
initializeTaskManager(taskStore);
console.log("[Tasks] Task system ready");

// =============================================================================
// Dependency Injection Container
// =============================================================================

console.log("[DI] Setting up dependency injection...");
const providerRegistry = getProviderRegistry({
  repository: DatabaseAccess.getInstance().providers,
});
const providerApiKeyStore = createProviderApiKeyStore(
  DatabaseAccess.getInstance(),
);
await hydrateProviderRegistryFromStore(providerRegistry, providerApiKeyStore);

// =============================================================================
// OAuth Token Hydration (load OAuth tokens into provider registry)
// =============================================================================

console.log("[OAuth] Hydrating OAuth tokens...");
const oauthRepository = new ProviderOAuthRepository(
  DatabaseAccess.getInstance().getDb(),
  new QueryLogger(),
);
const oauthService = new OAuthService(oauthRepository);

// Load all authenticated providers and inject tokens into registry
const authenticatedProviders = await oauthService.listAuthenticatedProviders();
for (const providerId of authenticatedProviders) {
  try {
    const token = await oauthService.getValidToken(providerId as OAuthProvider);
    if (token) {
      await providerRegistry.setOAuthToken(providerId as ProviderId, token);
      console.log(`[OAuth] Hydrated token for provider: ${providerId}`);
    }
  } catch (err) {
    console.error(`[OAuth] Failed to hydrate token for ${providerId}:`, err);
  }
}
console.log(`[OAuth] Hydrated ${authenticatedProviders.length} OAuth tokens`);

createOAuthCleanup(oauthService);

const providerResolver = createProviderResolver(providerRegistry);

// =============================================================================
// Task Orchestrator Initialization (Queue-based Task System)
// Must be initialized BEFORE DI setup (StreamService depends on it)
// =============================================================================

console.log("[TaskOrchestrator] Initializing...");
const taskOrchestrator = initializeTaskOrchestrator(
  DatabaseAccess.getInstance(),
  providerRegistry,
  {
    queue: { maxConcurrentPerProvider: 3 },
    debug: NODE_ENV === "development",
  },
);

// Initialize MessageService after orchestrator (uses singletons)
initializeMessageService();

// Resume interrupted tasks from previous session (crash recovery)
await taskOrchestrator.resumeTasksOnStartup();
console.log("[TaskOrchestrator] Crash recovery complete");

// =============================================================================
// DI Container Setup (with TaskOrchestrator)
// =============================================================================

const container = setupDIContainer({
  db: DatabaseAccess.getInstance(),
  providerRegistry,
  providerResolver,
  providerApiKeyStore,
  taskManager,
  taskOrchestrator,
});

const toolRegistry = container.resolve(
  TOKENS.ToolRegistry,
) as import("./domain/services/tools/tool-registry").ToolRegistry;
const contentEditorService = container.resolve(
  TOKENS.ContentEditorService,
) as import("./domain/services/content-editor").ContentEditorService;

const toolDispatcher = new ToolDispatcher(
  DatabaseAccess.getInstance(),
  toolRegistry,
);
taskOrchestrator.setToolDispatcher(toolDispatcher);

// Register edit_content tool via ToolSpec (replaces dispatcher special-case)
const _editContentDisposer = toolRegistry.register(
  editContentToolSpec,
  createEditContentHandler(contentEditorService),
);
void _editContentDisposer;

// Register format_content tool
const contentTargetRegistryForFormat = container.resolve(
  TOKENS.ContentTargetRegistry,
) as import("./domain/services/content-editor/content-target-registry").ContentTargetRegistry;
const _formatContentDisposer = toolRegistry.register(
  formatContentToolSpec,
  createFormatContentHandler(
    contentTargetRegistryForFormat,
    DatabaseAccess.getInstance().contentEditSnapshots,
  ),
);
void _formatContentDisposer;

const coreDb = DatabaseAccess.getInstance();
toolRegistry.register(
  coreTools.getContextToolSpec,
  coreTools.createGetContextHandler(coreDb),
);
toolRegistry.register(
  coreTools.listChatsToolSpec,
  coreTools.createListChatsHandler(coreDb),
);
toolRegistry.register(
  coreTools.listProjectsToolSpec,
  coreTools.createListProjectsHandler(coreDb),
);
toolRegistry.register(
  coreTools.getProjectToolSpec,
  coreTools.createGetProjectHandler(coreDb),
);
toolRegistry.register(
  coreTools.listFilesToolSpec,
  coreTools.createListFilesHandler(coreDb),
);
toolRegistry.register(
  coreTools.listBookmarksSpec,
  coreTools.createListBookmarksHandler(coreDb),
);
toolRegistry.register(
  coreTools.listFavoritesSpec,
  coreTools.createListFavoritesHandler(coreDb),
);
toolRegistry.register(
  coreTools.searchToolSpec,
  coreTools.createSearchHandler(coreDb),
);

// =============================================================================
// DI Container - CoreRouter
// =============================================================================

const coreRouter = new CoreRouter(container);
console.log("[DI] Container and CoreRouter initialized");

// =============================================================================
// Mention Registry Initialization (before modules, so they can register providers)
// =============================================================================

MentionRegistry.init();
console.log("[MentionRegistry] Mention system initialized");

// =============================================================================
// Module Loading
// =============================================================================

const moduleLoader = new ModuleLoader(REPO_ROOT, db);
// Pass ContentTargetRegistry to modules for content editor integration
const contentTargetRegistry = container.resolve(
  TOKENS.ContentTargetRegistry,
) as import("./domain/services/content-editor/content-target-registry").ContentTargetRegistry;
moduleLoader.setContentTargetRegistry(contentTargetRegistry);
moduleLoader.setToolRegistry(toolRegistry);
await moduleLoader.loadAll();

// =============================================================================
// HTTP Server
// =============================================================================

function safeTokenCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Still run comparison to avoid timing side-channel on length
    timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  fetch: async (req, server) => {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin");
    const withRequestCors = (response: Response): Response =>
      withCorsHeaders(response, origin);

    // WebSocket upgrade
    if (url.pathname.startsWith("/ws/modules/")) {
      const match = url.pathname.match(/^\/ws\/modules\/([^/]+)/);
      if (!match) {
        return ResponseBuilder.notFound("WebSocket endpoint");
      }

      const moduleId = match[1]!;
      const wsManager = moduleLoader.getWsManager(moduleId);

      if (!wsManager) {
        return ResponseBuilder.notFound(`Module "${moduleId}"`);
      }

      const clientId = crypto.randomUUID();
      const upgraded = server.upgrade(req, {
        data: { id: clientId, moduleId } as any,
      });

      if (!upgraded) {
        return ResponseBuilder.internalError("WebSocket upgrade failed");
      }

      return undefined;
    }

    // CORS preflight
    if (req.method === "OPTIONS") {
      return corsPreflightResponse(origin);
    }

    if (
      url.pathname.startsWith("/api/") &&
      url.pathname !== "/api/health" &&
      !isTrustedOrigin(origin)
    ) {
      return withRequestCors(
        ResponseBuilder.error("FORBIDDEN_ORIGIN", "Origin is not allowed", 403),
      );
    }

    // Authentication
    if (
      !ALLOW_UNAUTHENTICATED_API &&
      url.pathname.startsWith("/api/") &&
      url.pathname !== "/api/health"
    ) {
      const token = req.headers.get("X-OpenPCB-Token");
      const kernelToken = process.env.KERNEL_TOKEN;
      if (!kernelToken) {
        if (NODE_ENV === "production") {
          console.warn("[Auth] KERNEL_TOKEN not configured in production");
          return withRequestCors(
            ResponseBuilder.unauthorized("Authentication required"),
          );
        }
        // Dev mode: skip auth when KERNEL_TOKEN is not set
      } else if (!safeTokenCompare(token ?? "", kernelToken)) {
        return withRequestCors(
          ResponseBuilder.unauthorized("Invalid or missing KERNEL_TOKEN"),
        );
      }
    }

    // License enforcement for protected endpoints
    if (
      url.pathname.startsWith("/api/stream/") ||
      url.pathname.startsWith("/api/chats")
    ) {
      const denial = await LicenseUtil.getDenialIfNotAllowed();
      if (denial) {
        return withRequestCors(
          new Response(JSON.stringify(denial), { status: 403 }),
        );
      }
    }

    // Core routes (using new CoreRouter with DI)
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname.startsWith("/api/modules/")) {
        const response = await moduleRouterRegistry.handleModuleRequest(
          req,
          url.pathname,
        );
        return withRequestCors(response);
      }
      const coreResponse = await coreRouter.handle(req);
      if (coreResponse.status !== 404) {
        return withRequestCors(coreResponse);
      }
    }

    if (
      HAS_WEB_DIST &&
      req.method === "GET" &&
      !url.pathname.startsWith("/ws/") &&
      !url.pathname.startsWith("/api")
    ) {
      const staticAssetPath = resolveStaticAssetPath(url.pathname);
      if (staticAssetPath) {
        const assetFile = Bun.file(staticAssetPath);
        if (await assetFile.exists()) {
          return new Response(assetFile as unknown as BodyInit);
        }
      }

      const indexFile = Bun.file(path.join(WEB_DIST_DIR, "index.html"));
      if (await indexFile.exists()) {
        return new Response(indexFile as unknown as BodyInit);
      }
    }

    // Root endpoint
    if (url.pathname === "/") {
      return ResponseBuilder.text("OpenPCB Bun Sidecar - Running");
    }

    // API info endpoint
    if (url.pathname === "/api") {
      return withRequestCors(
        ResponseBuilder.json({
          name: "OpenPCB Bun Sidecar",
          version: "2.0.0",
          startupContractVersion: STARTUP_CONTRACT_VERSION,
          startupLicenseState: STARTUP_LICENSE_STATE,
          startupLicenseCode: STARTUP_LICENSE_CODE,
          endpoints: {
            health: "/api/health",
            modules: "/api/modules/:moduleId/*",
            websocket: "/ws/modules/:moduleId",
          },
          loadedModules: moduleLoader.getModuleIds(),
        }),
      );
    }

    // 404 for everything else
    return ResponseBuilder.notFound("Endpoint");
  },
  websocket: {
    open(ws: any) {
      const { id, moduleId } = ws.data;
      const wsManager = moduleLoader.getWsManager(moduleId);

      if (wsManager) {
        wsManager.addClient(id, ws);
        console.log(`[WS] Client ${id} connected to module ${moduleId}`);
      }
    },
    message(ws: any, message) {
      const { id, moduleId } = ws.data;
      const wsManager = moduleLoader.getWsManager(moduleId);

      if (wsManager) {
        wsManager.handleMessage(id, message as string);
      }
    },
    close(ws: any) {
      const { id, moduleId } = ws.data;
      const wsManager = moduleLoader.getWsManager(moduleId);

      if (wsManager) {
        wsManager.removeClient(id);
        console.log(`[WS] Client ${id} disconnected from module ${moduleId}`);
      }
    },
  },
});

// =============================================================================
// Startup
// =============================================================================

console.log(
  JSON.stringify({
    serverAddress: `http://localhost:${server.port}`,
    serverPort: server.port,
    status: "Server is running",
    startupContractVersion: STARTUP_CONTRACT_VERSION,
    startupLicenseState: STARTUP_LICENSE_STATE,
    startupLicenseCode: STARTUP_LICENSE_CODE,
    env: NODE_ENV,
    loadedModules: moduleLoader.getModuleIds().length,
  }),
);

console.error(
  `[Bun Sidecar] Server running on http://localhost:${server.port}`,
);
console.error(`[Bun Sidecar] Environment: ${NODE_ENV}`);
console.error(
  `[Bun Sidecar] Loaded modules: ${moduleLoader.getModuleIds().length}`,
);

// =============================================================================
// Scheduled Cleanup Tasks
// =============================================================================

// Cleanup old task chunks daily (30-day retention)
const CHUNK_RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

const runChunkCleanup = async () => {
  try {
    const deleted =
      await DatabaseAccess.getInstance().taskChunks.cleanupOldChunks(
        CHUNK_RETENTION_DAYS,
      );
    if (deleted > 0) {
      console.log(
        `[Cleanup] Deleted ${deleted} old task chunks (retention: ${CHUNK_RETENTION_DAYS} days)`,
      );
    }
  } catch (err) {
    console.error("[Cleanup] Failed to cleanup old task chunks:", err);
  }
};

// Run initial cleanup after 1 minute (let system stabilize)
setTimeout(runChunkCleanup, 60_000);

// Schedule daily cleanup
setInterval(runChunkCleanup, CLEANUP_INTERVAL_MS);
console.log(
  `[Cleanup] Scheduled task chunk cleanup (${CHUNK_RETENTION_DAYS}-day retention, daily)`,
);

// Branch cleanup - archive inactive branches after 90 days, hard delete after 180
const BRANCH_RETENTION_DAYS = 90;

const runBranchCleanup = async () => {
  try {
    const result =
      await DatabaseAccess.getInstance().messages.cleanupInactiveBranches(
        BRANCH_RETENTION_DAYS,
      );
    const hardDeleted =
      await DatabaseAccess.getInstance().messages.hardDeleteSoftDeleted(
        BRANCH_RETENTION_DAYS * 2,
      );

    if (result > 0 || hardDeleted > 0) {
      console.log(
        `[Cleanup] Branch cleanup: ${result} soft-deleted, ${hardDeleted} permanently removed`,
      );
    }
  } catch (err) {
    console.error("[Cleanup] Failed to cleanup inactive branches:", err);
  }
};

setTimeout(runBranchCleanup, 120_000);
setInterval(runBranchCleanup, CLEANUP_INTERVAL_MS);
console.log(
  `[Cleanup] Scheduled branch cleanup (${BRANCH_RETENTION_DAYS}-day retention, daily)`,
);

// =============================================================================
// OAuth Token Refresh (background task to refresh expiring tokens)
// =============================================================================

const OAUTH_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const OAUTH_EXPIRY_BUFFER_SECONDS = 120; // Refresh if expires within 2 minutes

const runOAuthRefresh = async () => {
  try {
    const providers = await oauthService.listAuthenticatedProviders();
    for (const providerId of providers) {
      try {
        // Check if token is expiring soon
        const isExpiring = await oauthRepository.isExpired(
          providerId,
          OAUTH_EXPIRY_BUFFER_SECONDS,
        );

        if (isExpiring) {
          console.log(`[OAuth] Refreshing token for ${providerId}...`);
          const token = await oauthService.getValidToken(
            providerId as OAuthProvider,
          );
          if (token) {
            await providerRegistry.setOAuthToken(
              providerId as ProviderId,
              token,
            );
            console.log(`[OAuth] Refreshed token for ${providerId}`);
          }
        }
      } catch (err) {
        console.warn(`[OAuth] Failed to refresh token for ${providerId}:`, err);
      }
    }
  } catch (err) {
    console.error("[OAuth] OAuth token refresh failed:", err);
  }
};

// Run initial OAuth refresh after 2 minutes (let system stabilize)
setTimeout(runOAuthRefresh, 120_000);

// Schedule periodic refresh every 5 minutes
setInterval(runOAuthRefresh, OAUTH_REFRESH_INTERVAL_MS);
console.log(
  "[OAuth] Scheduled token refresh (every 5 minutes, 2-min expiry buffer)",
);
