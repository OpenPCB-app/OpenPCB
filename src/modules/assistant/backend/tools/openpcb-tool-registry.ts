import { AiToolRegistry, type AiTool } from "agentkit/core";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import type { ContextResolver } from "../context-resolver";
import type { ProposalConversationPort } from "./designer-tools";
import { makeDesignerCompileCircuitTool } from "../compiler/compile-circuit-tool";
import { registerLibraryTools } from "./library-tools";
import { registerDesignerTools, type DesignerToolOptions } from "./designer-tools";

export function buildOpenpcbToolRegistry(
  ctx: CoreBackendModuleContext,
  contextResolver: ContextResolver,
  conversation: ProposalConversationPort | undefined,
  options: {
    allowRawToolData: boolean; designerTools?: DesignerToolOptions;
    stageCompilation?: Parameters<typeof makeDesignerCompileCircuitTool>[2];
  },
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
  // Compiler-agent tool — registered here (not in registerDesignerTools) to keep
  // its designer-tools helper imports one-way and avoid an import cycle.
  registry.register(
    makeDesignerCompileCircuitTool(ctx, contextResolver, options.stageCompilation) as unknown as AiTool,
  );
  return registry;
}
