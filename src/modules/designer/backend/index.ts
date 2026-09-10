import type { ModuleDefinition } from "../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { MentionRegistry } from "../../../core/backend/mentions";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { disposeDrcWorker } from "../../../shared/drc/worker/drc-worker-client";
import { resolveCaptureRuntime } from "./capture";
import { registerRoutes } from "./routes";
import { buildDesignerSdk } from "./sdk";
import { DesignMentionProvider } from "./providers/mention-provider";

// One per process, not per activation: test files boot many runtimes.
let drcWorkerSigtermHooked = false;

export const definition: ModuleDefinition = {
  id: "designer",

  async onActivate(ctx) {
    ctx.logger.info("designer activated", {
      tablePrefix: ctx.db.tablePrefix,
    });

    const db = ctx.db.db as BetterSQLite3Database<Record<string, unknown>>;
    const mentionProvider = new DesignMentionProvider(db);
    MentionRegistry.get().register(mentionProvider);

    // Dataset capture (WP-D4): finalize open session-log segments on shutdown.
    const capture = resolveCaptureRuntime(ctx);
    if (capture.enabled) {
      const flush = () => capture.endAll();
      process.once("SIGTERM", flush);
      process.once("beforeExit", flush);
    }

    // The DRC worker is a live thread that `unref()` does NOT let the process
    // exit past (execution contract 09 §2.3), so a signal — a `bun --watch`
    // restart included — must terminate it explicitly.
    if (!drcWorkerSigtermHooked) {
      drcWorkerSigtermHooked = true;
      process.once("SIGTERM", () => void disposeDrcWorker());
    }
  },

  async registerSdk(ctx) {
    if (!ctx.sdk.has(MODULE_SDK_TOKENS.DESIGNER)) {
      ctx.sdk.registerValue(MODULE_SDK_TOKENS.DESIGNER, buildDesignerSdk(ctx));
    }
  },

  async registerRoutes(router, ctx) {
    registerRoutes(router, ctx);
  },
};

export default definition;
