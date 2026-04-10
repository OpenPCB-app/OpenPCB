import type { ModuleDefinition } from "../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS } from "../../../core/contracts/modules/sdk-map";
import { buildSdk } from "./queries";
import { registerRoutes } from "./routes";
import { seedIfEmpty } from "./seed";

export const definition: ModuleDefinition = {
  id: "library",

  async onActivate(ctx) {
    seedIfEmpty(ctx);
    ctx.logger.info("library activated", {
      tablePrefix: ctx.db.tablePrefix,
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
