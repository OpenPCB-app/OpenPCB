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
      argumentsJson = JSON.stringify(input.args ?? {});
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
      resultJson: outcome.resultJson,
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
