import { AiToolRegistry } from "@openpcb/ai-core";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import type { ContextResolver } from "../context-resolver";
import { registerLibraryTools } from "./library-tools";
import { registerDesignerTools } from "./designer-tools";

export function buildOpenpcbToolRegistry(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  options: { allowRawToolData: boolean },
): AiToolRegistry {
  const registry = new AiToolRegistry();
  registerLibraryTools(registry, ctx, options);
  registerDesignerTools(registry, ctx, contextResolver);
  return registry;
}
