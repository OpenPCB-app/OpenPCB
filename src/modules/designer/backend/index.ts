import type { ModuleDefinition } from "../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS } from "../../../core/contracts/modules/sdk-map";
import { registerRoutes } from "./routes";
import { buildDesignerSdk } from "./sdk";

export const definition: ModuleDefinition = {
  id: "designer",

  async onActivate(ctx) {
    ctx.logger.info("designer activated", {
      tablePrefix: ctx.db.tablePrefix,
    });
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
