import {
  fromJsonSchema,
  type McpServer,
} from "@modelcontextprotocol/server";
import type {
  AiTool,
  AiToolExecutionContext,
  AiToolRegistry,
  AiToolResult,
} from "@openpcb/ai-core";
import { resolveToolLimits } from "@openpcb/ai-core";
import type { ContextResolver } from "../context-resolver";
import type { ConversationStore } from "../conversation-store";
import type { McpCallRecorder } from "./call-recorder";
import type { McpConnection, McpConnectionRegistry } from "./connections";
import {
  buildEnvelope,
  extractProposalRef,
  failureResult,
  toCallToolResult,
  type McpCallToolResult,
  type McpProposalRef,
} from "./result-envelope";
import { annotationsFor, mcpDescription, metaFor } from "./tool-policy";

/**
 * Project the assistant's `AiToolRegistry` onto an MCP server.
 *
 * `AiToolDefinition` is already MCP-shaped — `{name, description, inputSchema}`
 * with a name pattern MCP accepts verbatim — so this is a projection, not a
 * reimplementation. What the projection adds around each call:
 *
 * 1. **Targeting.** The design comes from explicit arg → session pin → the
 *    UI-focused design → the connection's last design (`connections.ts`), and
 *    the call runs in the chat bound to that design, so every in-app tool
 *    resolves it through its chat binding unchanged.
 * 2. **Recording.** Every call becomes a tool event on a visible activity
 *    message (`call-recorder.ts`): the user sees what the agent did, and a
 *    write proposal gets the event its approval card is rendered from.
 * 3. **Result envelope** (`result-envelope.ts`) — readable in both halves of
 *    the MCP result, because clients disagree on which half the model sees.
 * 4. **Liveness.** A heartbeat progress notification while a call runs (when
 *    the client asked for progress), so a slow DRC or ERC does not trip the
 *    client's idle timeout; and the request's abort signal reaches the tool.
 */

/**
 * `createMcpHandler` builds a fresh server per request, which re-registers
 * every tool; converting ~40 JSON Schemas each time is the dominant cost, so
 * keep the converted schema per tool definition.
 */
const schemaCache = new WeakMap<AiTool, ReturnType<typeof fromJsonSchema>>();

function inputSchemaFor(tool: AiTool): ReturnType<typeof fromJsonSchema> {
  let schema = schemaCache.get(tool);
  if (!schema) {
    schema = fromJsonSchema<Record<string, unknown>>(tool.definition.inputSchema);
    schemaCache.set(tool, schema);
  }
  return schema;
}

/** Tools that act on a design accept `designId` — detected from the schema. */
export function acceptsDesignId(tool: AiTool): boolean {
  const props = tool.definition.inputSchema.properties;
  return Boolean(props && "designId" in props);
}

/** Interval between heartbeat progress notifications. */
export const HEARTBEAT_MS = 10_000;

/** The slice of the SDK's request context the projection uses. */
export interface McpRequestCtx {
  mcpReq?: {
    signal?: AbortSignal;
    _meta?: { progressToken?: string | number } & Record<string, unknown>;
    notify?: (notification: {
      method: string;
      params?: Record<string, unknown>;
    }) => Promise<void>;
  };
}

/**
 * Run `work` while sending `notifications/progress` every HEARTBEAT_MS, if the
 * client supplied a progress token. Progress resets Claude Code's idle timer
 * (5 minutes for HTTP servers); it never extends the wall-clock limit.
 */
export async function withHeartbeat<T>(
  ctx: McpRequestCtx | undefined,
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  const token = ctx?.mcpReq?._meta?.progressToken;
  const notify = ctx?.mcpReq?.notify;
  if (token === undefined || !notify) return work();
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    void notify({
      method: "notifications/progress",
      params: {
        progressToken: token,
        progress: ticks,
        message: `${label}: still working (${(ticks * HEARTBEAT_MS) / 1000}s)`,
      },
    }).catch(() => undefined);
  }, HEARTBEAT_MS);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

export interface ToolProjectionDeps {
  registry: AiToolRegistry;
  connections: McpConnectionRegistry;
  recorder: McpCallRecorder;
  contextResolver: ContextResolver;
  conversation: ConversationStore;
  /** When false, `effect: "write"` tools are not registered at all. */
  allowWrites: boolean;
  /** Next step the model should take while a proposal waits for the user. */
  pendingProposalHint: (chatTitle: string) => string;
}

function proposalRefFor(
  deps: ToolProjectionDeps,
  chatId: string,
  data: unknown,
): McpProposalRef | null {
  const ref = extractProposalRef(data);
  if (!ref) return null;
  const record = deps.conversation.getWriteProposal(chatId, ref.id);
  const status = record?.status ?? "pending";
  const proposal: McpProposalRef = {
    id: ref.id,
    kind: record?.kind ?? ref.kind,
    status,
    riskLevel: record?.riskLevel ?? null,
    designId: record?.designId ?? null,
    operationCount: record?.operations?.length ?? 0,
  };
  if (status === "pending") {
    const title = deps.conversation.getChat(chatId)?.title ?? "the MCP chat";
    proposal.approvalHint = deps.pendingProposalHint(title);
  }
  return proposal;
}

function thrownResult(message: string): AiToolResult<null> {
  return {
    ok: false,
    data: null,
    summary: message,
    sources: [],
    warnings: [message],
    truncated: false,
    limits: resolveToolLimits({ preference: "large" }),
  };
}

/**
 * One projected call: target → chat → record → execute → adopt/pin → envelope.
 * Exported for tests.
 */
export async function runProjectedTool(
  tool: AiTool,
  connection: McpConnection,
  deps: ToolProjectionDeps,
  input: Record<string, unknown> | undefined,
  requestCtx?: McpRequestCtx,
): Promise<McpCallToolResult> {
  const def = tool.definition;
  const args: Record<string, unknown> = { ...(input ?? {}) };
  const extraWarnings: string[] = [];

  let chatId: string | null = null;
  let targetDesignId: string | null = null;
  if (acceptsDesignId(tool)) {
    const target = deps.connections.resolveDesign(
      connection,
      typeof args.designId === "string" && args.designId.trim()
        ? args.designId.trim()
        : null,
    );
    if (target) {
      args.designId = target.designId;
      targetDesignId = target.designId;
      if (target.warning) extraWarnings.push(target.warning);
      chatId = await deps.connections.designChat(connection, target.designId);
    }
  }
  const ranInHomeChat = chatId === null;
  if (chatId === null) chatId = deps.connections.homeChat(connection);

  const call = deps.recorder.begin({
    chatId,
    connection,
    toolName: def.name,
    args,
  });

  const execCtx: AiToolExecutionContext = {
    runId: deps.connections.nextRunId(connection),
    chatId,
    bindings: deps.contextResolver.listBindings(chatId),
    // Claude-class models have large contexts; the in-app "small/medium"
    // presets exist for local models and do not apply to an external agent.
    limits: resolveToolLimits({ preference: "large" }),
    signal: requestCtx?.mcpReq?.signal,
    metadata: { mcp: { clientKey: connection.clientKey, instanceId: connection.instanceId } },
  };

  let result: AiToolResult;
  let completed = true;
  try {
    result = await withHeartbeat(requestCtx, def.name, () =>
      tool.execute(execCtx, args),
    );
  } catch (error) {
    completed = false;
    const message = error instanceof Error ? error.message : String(error);
    result = thrownResult(`${def.name} failed: ${message}`);
  }

  if (ranInHomeChat) {
    const adopted = deps.connections.adoptBoundHomeChat(connection, chatId);
    if (adopted) targetDesignId = adopted;
  }
  if (targetDesignId && result.ok) connection.lastDesignId = targetDesignId;

  if (extraWarnings.length > 0) {
    result = { ...result, warnings: [...(result.warnings ?? []), ...extraWarnings] };
  }

  const proposal = proposalRefFor(deps, chatId, result.data);
  const envelope = buildEnvelope(result, proposal);

  let resultJson: string | null = null;
  try {
    resultJson = result.data === undefined ? null : JSON.stringify(result.data);
  } catch {
    resultJson = null;
  }
  deps.recorder.end(call, {
    completed,
    ok: result.ok,
    summary: envelope.summary,
    resultJson,
    error: envelope.error?.message ?? null,
    sources: result.sources,
  });

  return completed ? toCallToolResult(envelope) : failureResult(envelope.summary);
}

export function registerProjectedTools(
  server: McpServer,
  connection: McpConnection,
  deps: ToolProjectionDeps,
): void {
  for (const tool of deps.registry.list()) {
    const def = tool.definition;
    // Don't advertise what would only be refused: a client that cannot see a
    // write tool gets a clean capability picture instead of a runtime denial.
    if (!deps.allowWrites && def.effect === "write") continue;

    const meta = metaFor(tool);
    server.registerTool(
      def.name,
      {
        description: mcpDescription(tool),
        inputSchema: inputSchemaFor(tool),
        annotations: annotationsFor(tool),
        ...(meta ? { _meta: meta } : {}),
      },
      (input: unknown, ctx: unknown) =>
        runProjectedTool(
          tool,
          connection,
          deps,
          (input ?? {}) as Record<string, unknown>,
          ctx as McpRequestCtx,
        ),
    );
  }
}

/**
 * Pin this connection to a design.
 *
 * Connection-scoped, so it lives here rather than in the shared registry: it
 * is the only tool that writes connection state, and there is no connection
 * when the same registry backs the in-app assistant. It changes nothing in the
 * design or any chat, hence read-only.
 */
export function registerUseDesignTool(
  server: McpServer,
  connection: McpConnection,
  listDesigns: () => Promise<Array<{ id: string; name: string }>>,
): void {
  server.registerTool(
    "designer_use_design",
    {
      description:
        "Pin this MCP session to a design so later calls do not need designId. The pin beats the design the user has focused in the OpenPCB UI and lasts until the session goes idle; pass null to drop it and follow the UI again. Call designer_list_designs first to get an id.",
      inputSchema: fromJsonSchema<{ designId?: string | null }>({
        type: "object",
        properties: {
          designId: {
            type: ["string", "null"],
            description: "Design id to pin, or null to clear the pin.",
          },
        },
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: { designId?: string | null } | undefined) => {
      const requested = (input ?? {}).designId ?? null;
      if (requested === null) {
        connection.pinnedDesignId = null;
        return toCallToolResult({
          ok: true,
          status: "ok",
          summary: "Pin cleared; following the design focused in OpenPCB.",
          warnings: [],
          truncated: false,
          data: { pinnedDesignId: null },
        });
      }
      const match = (await listDesigns()).find((d) => d.id === requested);
      if (!match) {
        return failureResult(
          `No design with id '${requested}'. Call designer_list_designs for valid ids.`,
        );
      }
      connection.pinnedDesignId = match.id;
      connection.lastDesignId = match.id;
      return toCallToolResult({
        ok: true,
        status: "ok",
        summary: `Pinned to "${match.name}".`,
        warnings: [],
        truncated: false,
        data: { pinnedDesignId: match.id, name: match.name },
      });
    },
  );
}
