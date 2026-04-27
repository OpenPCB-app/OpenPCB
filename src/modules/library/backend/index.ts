import type { ModuleDefinition } from "../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { buildSdk } from "./queries";
import { registerRoutes } from "./routes";

export const definition: ModuleDefinition = {
  id: "library",

  async onActivate(ctx) {
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
