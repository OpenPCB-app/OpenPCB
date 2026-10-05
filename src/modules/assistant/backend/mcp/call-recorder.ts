import { createHash } from "node:crypto";
import type { AiSourceRef } from "@openpcb/ai-core";
import type { AssistantMessage } from "../../../../sdks";
import type { ConversationStore } from "../conversation-store";
import type { McpConnection } from "./connections";

/**
 * Persists every MCP tool call into the backing chat so the user can watch the
 * external agent in the assistant panel — and, crucially, so write proposals
 * get the tool event their approval card is rendered from (`MessageCard`
 * builds proposal cards from `succeeded` tool events whose result JSON is
 * `{id, kind}`, attached to a visible message).
 *
 * Deliberately NOT the in-app run-service path: that one writes `role:"tool"`
 * replay messages tied to provider tool calls, and replaying those without the
 * assistant `toolCalls` message that introduced them would corrupt the in-app
 * history if the user later types into this chat. Here each burst of calls
 * hangs off one plain, visible assistant "activity" message.
 */

/** A burst of calls from one connection shares an activity message for this long. */
export const ACTIVITY_WINDOW_MS = 15 * 60 * 1000;

/**
 * Audit storage budget. An agent loop can call a large read (PCB layout, DRC,
 * connectivity) dozens of times; storing each full result would grow the
 * chat database by megabytes per session for data nobody re-reads — the
 * model already got it, and the design is the source of truth. So results are
 * stored whole only where the panel renders them, or when small; anything
 * else becomes a digest (size, hash, preview).
 */
export const MAX_STORED_RESULT_CHARS = 8_000;
export const MAX_STORED_ARGS_CHARS = 16_000;
const PREVIEW_CHARS = 2_000;

/** Tools whose tool-event result `MessageCard` parses into a card — kept whole. */
const PANEL_RENDERED_TOOLS: ReadonlySet<string> = new Set([
  "library_search_components",
  "library_resolve_bom",
  "designer_place_components",
]);

function preview(json: string): string {
  const code = json.charCodeAt(PREVIEW_CHARS - 1);
  const end = code >= 0xd800 && code <= 0xdbff ? PREVIEW_CHARS - 1 : PREVIEW_CHARS;
  return json.slice(0, end);
}

function digest(json: string): string {
  return JSON.stringify({
    digest: true,
    bytes: Buffer.byteLength(json, "utf8"),
    sha256: createHash("sha256").update(json).digest("hex"),
    preview: preview(json),
  });
}

/**
 * What to persist as a call's result. Proposal results keep only the keys the
 * card joins on (`{id, kind, designId, baseRevision}`) — the full envelope is
 * already stored once, in the proposal record.
 */
export function storedResultJson(toolName: string, resultJson: string | null): string | null {
  if (resultJson === null) return null;
  if (PANEL_RENDERED_TOOLS.has(toolName)) return resultJson;
  try {
    const parsed = JSON.parse(resultJson) as Record<string, unknown> | null;
    if (parsed && typeof parsed.id === "string" && typeof parsed.kind === "string") {
      return JSON.stringify({
        id: parsed.id,
        kind: parsed.kind,
        designId: parsed.designId ?? null,
        baseRevision: parsed.baseRevision ?? null,
      });
    }
  } catch {
    // not JSON: fall through to the size rule
  }
  return resultJson.length <= MAX_STORED_RESULT_CHARS ? resultJson : digest(resultJson);
}

/** Arguments are stored for the audit trail, bounded like results. */
export function storedArgumentsJson(argumentsJson: string): string {
  return argumentsJson.length <= MAX_STORED_ARGS_CHARS ? argumentsJson : digest(argumentsJson);
}

export interface RecordedCall {
  chatId: string;
  messageId: string;
  eventId: string;
  toolCallId: string;
  toolName: string;
  argumentsJson: string;
}

export interface McpCallRecorderDeps {
  conversation: ConversationStore;
  /** Fired after anything visible in `chatId` changed. */
  onChatActivity?: (chatId: string) => void;
  now?: () => number;
}

interface ActivityMetadata {
  activity: true;
  instanceId: string;
  clientName: string;
}

function activityOf(message: AssistantMessage): ActivityMetadata | null {
  const mcp = (message.metadata as { mcp?: unknown } | null)?.mcp;
  if (typeof mcp !== "object" || mcp === null) return null;
  return (mcp as { activity?: unknown }).activity === true
    ? (mcp as ActivityMetadata)
    : null;
}

function oneLine(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export class McpCallRecorder {
  private readonly now: () => number;

  constructor(private readonly deps: McpCallRecorderDeps) {
    this.now = deps.now ?? Date.now;
  }

  private activityMessage(chatId: string, connection: McpConnection): string {
    const latest = this.deps.conversation.listMessages(chatId, { limit: 1 })
      .items[0];
    if (latest && latest.role === "assistant") {
      const activity = activityOf(latest);
      const age = this.now() - Date.parse(latest.createdAt);
      if (
        activity &&
        activity.instanceId === connection.instanceId &&
        Number.isFinite(age) &&
        age < ACTIVITY_WINDOW_MS
      ) {
        return latest.id;
      }
    }
    const metadata: Record<string, unknown> = {
      mcp: {
        activity: true,
        instanceId: connection.instanceId,
        clientName: connection.clientName,
      } satisfies ActivityMetadata,
    };
    return this.deps.conversation.createMessage({
      chatId,
      role: "assistant",
      content: `**${connection.clientName}** is working in OpenPCB over MCP.`,
      metadata,
    }).id;
  }

  begin(input: {
    chatId: string;
    connection: McpConnection;
    toolName: string;
    args: Record<string, unknown>;
  }): RecordedCall {
    const messageId = this.activityMessage(input.chatId, input.connection);
    const toolCallId = `mcp_${crypto.randomUUID()}`;
    let argumentsJson = "{}";
    try {
      argumentsJson = storedArgumentsJson(JSON.stringify(input.args ?? {}));
    } catch {
      // keep "{}" — arguments are informational here
    }
    const event = this.deps.conversation.upsertToolEvent({
      chatId: input.chatId,
      taskId: null,
      messageId,
      toolCallId,
      toolName: input.toolName,
      status: "running",
      argumentsJson,
    });
    this.deps.onChatActivity?.(input.chatId);
    return {
      chatId: input.chatId,
      messageId,
      eventId: event.id,
      toolCallId,
      toolName: input.toolName,
      argumentsJson,
    };
  }

  end(
    call: RecordedCall,
    outcome: {
      /**
       * The tool returned a result (even an unsuccessful one). Mirrors the
       * in-app loop, which records any returned result as `succeeded` — only
       * a thrown execution is `failed`. It matters: proposal cards render
       * only from `succeeded` events, and a partial or pending write still
       * has a proposal the user must see.
       */
      completed: boolean;
      ok: boolean;
      summary: string;
      /** JSON of the tool's full `data` — what proposal/result cards parse. */
      resultJson: string | null;
      error?: string | null;
      sources?: AiSourceRef[];
    },
  ): void {
    this.deps.conversation.upsertToolEvent({
      id: call.eventId,
      chatId: call.chatId,
      taskId: null,
      messageId: call.messageId,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      status: outcome.completed ? "succeeded" : "failed",
      argumentsJson: call.argumentsJson,
      resultJson: storedResultJson(call.toolName, outcome.resultJson),
      errorJson: outcome.error ? JSON.stringify({ message: outcome.error }) : null,
      sources: outcome.sources ?? [],
    });
    this.deps.conversation.appendMessageContent(
      call.messageId,
      `\n- ${outcome.ok ? "✓" : "✗"} \`${call.toolName}\` — ${oneLine(outcome.summary)}`,
    );
    this.deps.onChatActivity?.(call.chatId);
  }
}
