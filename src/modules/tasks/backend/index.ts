import type { ModuleDefinition } from "../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { buildTasksSdk } from "./sdk";

export const definition: ModuleDefinition = {
  id: "tasks",
  onActivate(ctx) {
    ctx.logger.info("tasks monitor activated");
  },
  async registerSdk(ctx) {
    if (!ctx.sdk.has(MODULE_SDK_TOKENS.TASKS)) {
      ctx.sdk.registerValue(MODULE_SDK_TOKENS.TASKS, buildTasksSdk(ctx));
    }
  },
};

export default definition;
