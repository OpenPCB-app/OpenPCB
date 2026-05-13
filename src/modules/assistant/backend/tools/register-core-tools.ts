import { MODULE_SDK_TOKENS, type DesignerSDK, type LibrarySDK } from "../../../../sdks";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { AssistantToolRegistry } from "./tool-registry";

export function registerCoreTools(ctx: CoreBackendModuleContext): AssistantToolRegistry {
  const registry = new AssistantToolRegistry();
  const library = ctx.sdk.get<LibrarySDK>(MODULE_SDK_TOKENS.LIBRARY);
  const designer = ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);

  if (library) {
    registry.register({
      effect: "read",
      definition: {
        type: "function",
        function: {
          name: "library.search_components",
          description: "Search OpenPCB library components by query.",
          parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } } },
        },
      },
      execute: async (args) => {
        const input = args as { query?: string; limit?: number };
        return library.searchComponents({ query: input.query ?? "", limit: input.limit ?? 10 });
      },
    });
  }

  if (designer) {
    registry.register({
      effect: "read",
      definition: {
        type: "function",
        function: { name: "designer.list_designs", description: "List OpenPCB designs.", parameters: { type: "object", properties: {} } },
      },
      execute: () => designer.listDesigns(),
    });
  }

  return registry;
}
