import { McpServer } from "@modelcontextprotocol/server";
import type { AiToolRegistry } from "@openpcb/ai-core";
import type { ContextResolver } from "../context-resolver";
import type { ConversationStore } from "../conversation-store";
import type { McpCallRecorder } from "./call-recorder";
import type { McpClientIdentity, McpConnectionRegistry } from "./connections";
import {
  registerProjectedTools,
  registerUseDesignTool,
} from "./tool-projection";
import { registerResources } from "./resources";
import { registerPrompts } from "./prompts";
import { MCP_SERVER_INSTRUCTIONS } from "./instructions";
import { registerProposalTools } from "./proposal-tools";
import type { AssistantEventBus } from "../events";
import { MODULE_SDK_TOKENS, type DesignerSDK } from "../../../../sdks";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";

export const MCP_SERVER_NAME = "openpcb";

export interface BuildMcpServerDeps {
  ctx: CoreBackendModuleContext;
  appVersion: string;
  registry: AiToolRegistry;
  connections: McpConnectionRegistry;
  recorder: McpCallRecorder;
  events: AssistantEventBus;
  contextResolver: ContextResolver;
  conversation: ConversationStore;
  allowWrites: boolean;
  pendingProposalHint: (chatTitle: string) => string;
}

/**
 * Build the MCP server for one request.
 *
 * `createMcpHandler` calls this per HTTP request (the 2025-era path is
 * stateless), so it must stay cheap: connection state and chats are looked
 * up in `McpConnectionRegistry`, the tool registry is built once by the
 * caller, and converted input schemas are cached per tool.
 */
export function buildMcpServer(
  identity: McpClientIdentity,
  deps: BuildMcpServerDeps,
): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: deps.appVersion },
    {
      instructions: MCP_SERVER_INSTRUCTIONS,
      // Advertised so clients listen for list changes: the tool set changes
      // when the user toggles "Allow writes" (see McpEndpoint.notifyToolsChanged).
      capabilities: {
        tools: { listChanged: true },
        prompts: { listChanged: true },
        resources: { listChanged: true },
      },
    },
  );

  const connection = deps.connections.touch(identity);

  registerProjectedTools(server, connection, {
    registry: deps.registry,
    connections: deps.connections,
    recorder: deps.recorder,
    contextResolver: deps.contextResolver,
    conversation: deps.conversation,
    allowWrites: deps.allowWrites,
    pendingProposalHint: deps.pendingProposalHint,
  });

  registerUseDesignTool(server, connection, async () => {
    const designer = deps.ctx.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
    if (!designer) return [];
    return (await designer.listDesigns()).map((d) => ({
      id: d.id,
      name: d.name,
    }));
  });

  registerProposalTools(server, connection, {
    conversation: deps.conversation,
    events: deps.events,
  });

  registerResources(server, deps.ctx);
  registerPrompts(server, { allowWrites: deps.allowWrites });

  return server;
}
