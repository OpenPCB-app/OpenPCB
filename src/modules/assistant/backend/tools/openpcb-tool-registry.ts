import { AiToolRegistry } from "@openpcb/ai-core";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import type { ContextResolver } from "../context-resolver";
import type { ConversationStore } from "../conversation-store";
import { registerLibraryTools } from "./library-tools";
import { registerDesignerTools, type DesignerToolOptions } from "./designer-tools";

export function buildOpenpcbToolRegistry(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ConversationStore,
  options: { allowRawToolData: boolean; designerTools?: DesignerToolOptions },
): AiToolRegistry {
  const registry = new AiToolRegistry();
  registerLibraryTools(registry, ctx, options);
  registerDesignerTools(
    registry,
    ctx,
    contextResolver,
    conversation,
    options.designerTools,
  );
  return registry;
}
