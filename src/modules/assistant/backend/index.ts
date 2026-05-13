import type { ModuleDefinition } from "../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { initializeAssistantService } from "./assistant-service";
import { buildAssistantSdk } from "./sdk";
import { registerRoutes } from "./routes";

export const definition: ModuleDefinition = {
  id: "assistant",
  onActivate(ctx) {
    initializeAssistantService(ctx);
    ctx.logger.info("assistant activated", { tablePrefix: ctx.db.tablePrefix });
  },
  registerSdk(ctx) {
    if (!ctx.sdk.has(MODULE_SDK_TOKENS.ASSISTANT)) {
      ctx.sdk.registerValue(MODULE_SDK_TOKENS.ASSISTANT, buildAssistantSdk());
    }
  },
  registerRoutes(router, ctx) {
    registerRoutes(router, ctx);
  },
};

export default definition;
