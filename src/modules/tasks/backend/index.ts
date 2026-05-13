import type { ModuleDefinition } from "../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { initializeTaskRuntime } from "./runtime-singleton";
import { buildTasksSdk } from "./sdk";
import { registerRoutes } from "./routes";

export const definition: ModuleDefinition = {
  id: "tasks",
  async onActivate(ctx) {
    await initializeTaskRuntime(ctx);
    ctx.logger.info("tasks activated", { tablePrefix: ctx.db.tablePrefix });
  },
  async registerSdk(ctx) {
    if (!ctx.sdk.has(MODULE_SDK_TOKENS.TASKS)) {
      ctx.sdk.registerValue(MODULE_SDK_TOKENS.TASKS, buildTasksSdk());
    }
  },
  async registerRoutes(router, ctx) {
    registerRoutes(router, ctx);
  },
};

export default definition;
