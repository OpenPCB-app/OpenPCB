import { AiToolRegistry, type AiTool, type AiToolExecutionContext } from "agentkit/core";
import type { AiToolResult } from "agentkit/contracts";
import type { ToolSetContributor } from "agentkit/host";
import { MODULE_SDK_TOKENS, type DesignerSDK } from "../../../../sdks";
import { createNativeToolContributor, type NativeToolContributorOptions } from "./native-tools";
import { registerExtendedReadTools } from "../tools/read-tools";
import type { NativeMcpActors } from "./native-mcp-actors";
import type { NativeContextStore } from "./native-context-store";

export function createNativeMcpContributor(options: Omit<NativeToolContributorOptions, "actorScope"> & {
  actors: NativeMcpActors; contextStore: NativeContextStore;
}): ToolSetContributor {
  return {
    namespace: "openpcb",
    async contribute(contribution) {
      if (!contribution.actorId || !contribution.chatId) return [];
      const actorScope = options.actors.register(contribution.actorId, contribution.chatId);
      const native = await createNativeToolContributor({ ...options, actorScope }).contribute(contribution);
      const extended = new AiToolRegistry();
      registerExtendedReadTools(extended, options.context);
      return [...native, ...extended.list()].map((tool): AiTool => ({ definition: tool.definition,
        execute: (context, input) => executeSessionTool(options, actorScope, tool, context, input) }))
        .concat(pinTool(options, actorScope));
    },
  };
}

type McpOptions = Parameters<typeof createNativeMcpContributor>[0];

async function executeSessionTool(
  options: McpOptions, actorScope: string, tool: AiTool, context: AiToolExecutionContext, input: unknown,
): Promise<AiToolResult> {
  if (!context.chatId || !options.actors.has(actorScope, context.chatId)) throw new Error("MCP_ACTOR_DENIED");
  context.signal?.throwIfAborted();
  const acceptsDesign = Boolean(tool.definition.inputSchema.properties?.designId);
  const args = input && typeof input === "object" ? { ...input as Record<string, unknown> } : {};
  if (acceptsDesign) {
    const designer = options.context.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    const designId = typeof args.designId === "string" ? args.designId : options.actors.pinnedDesign(actorScope) ?? designer?.getActiveDesignId();
    if (designId) {
      await bindSession(options, context.chatId, designId);
      args.designId = designId;
    }
  }
  const result = await tool.execute(context, acceptsDesign ? args : input);
  if (!result.data || typeof result.data !== "object" || !("proposalId" in result.data)) return result;
  const data = result.data as Record<string, unknown>;
  return { ...result, modelData: { ...(result.modelData && typeof result.modelData === "object" ? result.modelData : {}),
    proposalId: data.proposalId, proposalStatus: data.status, envelope: data.envelope, outcome: data.outcome } };
}

async function bindSession(options: McpOptions, chatId: string, designId: string): Promise<void> {
  const designer = options.context.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  const design = await designer?.getDesign(designId);
  if (!design) throw new Error(`Design '${designId}' not found.`);
  const prior = options.contextResolver.getPrimaryDesign(chatId);
  if (prior?.refId === designId) return;
  if (prior) options.contextStore.deleteBinding(chatId, prior.id);
  await options.contextResolver.bindDesign(chatId, { id: design.head.id, name: design.head.name });
}

function pinTool(options: McpOptions, actorScope: string): AiTool {
  return {
    definition: { name: "designer_use_design", version: "1", effect: "read", capability: "designer.read",
      description: "Pin this MCP session to a design so later calls do not need designId. The pin beats the design the user has focused in the OpenPCB UI; pass null to drop it and follow the UI again. Call designer_list_designs first to get an id.",
      inputSchema: { type: "object", properties: { designId: { type: ["string", "null"],
        description: "Design id to pin, or null to clear the pin." } } } },
    async execute(context, input) {
      context.signal?.throwIfAborted();
      const args = input as { designId?: string | null };
      const requested = args.designId ?? null;
      if (!context.chatId || !options.actors.has(actorScope, context.chatId)) throw new Error("MCP_ACTOR_DENIED");
      if (requested) await bindSession(options, context.chatId, requested);
      else {
        const designer = options.context.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
        const active = designer?.getActiveDesignId();
        if (active) await bindSession(options, context.chatId, active);
        else {
          const prior = options.contextResolver.getPrimaryDesign(context.chatId);
          if (prior) options.contextStore.deleteBinding(context.chatId, prior.id);
        }
      }
      options.actors.pin(actorScope, requested);
      return { ok: true, data: { pinnedDesignId: requested }, modelData: { pinnedDesignId: requested },
        sources: [], warnings: [], truncated: false, limits: context.limits };
    },
  };
}
