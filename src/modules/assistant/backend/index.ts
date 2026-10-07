import type { ModuleDefinition } from "../../../core/contracts/modules/backend-module";
import { AGENTKIT_MONITOR_TOKEN } from "../../../sdks/tasks";
import { publicCredentialError } from "../../../core/contracts/credentials/secret-store";
import {
  createAgentKitService,
  type AgentKitService,
  type AgentKitServiceOptions,
} from "./agentkit-service";
import { registerAgentKitRoutes } from "./agentkit-routes";

export interface AssistantModuleOptions {
  agentkit?: AgentKitServiceOptions;
}

/** One canonical host owns fresh AgentKit history; legacy rows are never imported. */
export function createAssistantModuleDefinition(
  options: AssistantModuleOptions = {},
): ModuleDefinition {
  let service: AgentKitService | undefined;
  return {
    id: "assistant",
    async onActivate(context) {
      if (service)
        throw new Error("Assistant AgentKit runtime is already active");
      service = await createAgentKitService(context, options.agentkit);
      context.sdk.registerValue(
        "core.provider-credentials",
        service.host.credentialAccess,
      );
      context.sdk.registerValue("openpcb.agentkit-host", service.host);
      context.sdk.registerValue(AGENTKIT_MONITOR_TOKEN, service.runMonitor);
      try {
        await service.host.providers.migrateLegacyCredentials();
      } catch (error) {
        context.logger.warn("assistant credential migration deferred", {
          code: publicCredentialError(error).code,
        });
      }
      context.logger.info("assistant activated", { runtime: "agentkit" });
    },
    registerRoutes(router) {
      if (!service) throw new Error("Assistant AgentKit runtime is not active");
      registerAgentKitRoutes(router, service);
    },
    async onDeactivate() {
      try {
        await service?.close();
      } finally {
        service = undefined;
      }
    },
  };
}

export const definition = createAssistantModuleDefinition();
export default definition;
