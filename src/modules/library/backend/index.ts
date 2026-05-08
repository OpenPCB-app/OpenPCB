import type { ModuleDefinition } from "../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { rebuildPreviewModelsIfStale } from "./builtins/migrate-preview-models";
import { seedBuiltinComponents } from "./builtins/seed";
import { buildSdk } from "./queries";
import { registerRoutes } from "./routes";

export const definition: ModuleDefinition = {
  id: "library",

  async onActivate(ctx) {
    const seedResult = seedBuiltinComponents(ctx);
    const rebuildResult = rebuildPreviewModelsIfStale(ctx);
    ctx.logger.info("library activated", {
      tablePrefix: ctx.db.tablePrefix,
      seededComponents: seedResult.seededComponents,
      seededSymbols: seedResult.seededSymbols,
      refreshedSymbols: seedResult.refreshedSymbols,
      seededFootprints: seedResult.seededFootprints,
      refreshedFootprints: seedResult.refreshedFootprints,
      repointedComponents: seedResult.repointedComponents,
      rebuiltSymbols: rebuildResult.rebuiltSymbols,
      rebuildMs: rebuildResult.ms,
    });
  },

  async registerSdk(ctx) {
    if (!ctx.sdk.has(MODULE_SDK_TOKENS.LIBRARY)) {
      ctx.sdk.registerValue(MODULE_SDK_TOKENS.LIBRARY, buildSdk(ctx));
    }
  },

  async registerRoutes(router, ctx) {
    registerRoutes(router, ctx);
  },
};

export default definition;
