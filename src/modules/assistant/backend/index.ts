import type { ModuleDefinition } from "../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { initializeAssistantService } from "./assistant-service";
import { buildAssistantSdk } from "./sdk";
import { registerRoutes } from "./routes";
import { publicCredentialError } from "../../../core/contracts/credentials/secret-store";

export const definition: ModuleDefinition = {
  id: "assistant",
  async onActivate(ctx) {
    const service = initializeAssistantService(ctx);
    try {
      await service.providers.migrateLegacyCredentials();
    } catch (error) {
      ctx.logger.warn("assistant credential migration deferred", {
        code: publicCredentialError(error).code,
      });
    }
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
