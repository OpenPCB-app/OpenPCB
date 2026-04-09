import { success } from "../../../core/backend/runtime/http/response";
import type { CoreBackendModuleDefinition } from "../../../core/backend/runtime/modules/backend-module";
import type { AIServiceSDK } from "../../../core/contracts/modules/sdk";
import { MODULE_SDK_TOKENS } from "../../../core/contracts/modules/sdk-map";

export const backendModule: CoreBackendModuleDefinition = {
  id: "ai-service",
  registerSdk(ctx) {
    if (ctx.sdk.has(MODULE_SDK_TOKENS.AI_SERVICE)) {
      return;
    }
    const sdk: AIServiceSDK = {
      async complete(_params) {
        throw new Error("AIServiceSDK.complete not implemented yet");
      },
      async embed(_text) {
        throw new Error("AIServiceSDK.embed not implemented yet");
      },
    };
    ctx.sdk.registerValue(MODULE_SDK_TOKENS.AI_SERVICE, sdk);
  },
  registerRoutes(router, ctx) {
    router.get("/status", async () =>
      success({
        moduleId: ctx.moduleId,
        namespace: ctx.manifest.namespace,
        status: "ready",
      }),
    );
  },
};

export default backendModule;
