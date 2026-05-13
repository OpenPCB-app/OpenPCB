import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import type {
  AssistantChat,
  AssistantMessage,
  AssistantProviderId,
  CreateAssistantChatInput,
} from "../../../sdks/assistant";

function rawSqlFrom(ctx: CoreBackendModuleContext): (query: string, params?: unknown[]) => Record<string, unknown>[] {
  return (ctx.db as { rawSql<T = unknown>(query: string, params?: unknown[]): T[] }).rawSql.bind(ctx.db);
}

function id(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function encode(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function decode<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function rowToChat(row: Record<string, unknown>): AssistantChat {
  return {
    id: String(row.id),
    title: String(row.title),
    providerConfigId: row.provider_config_id ? String(row.provider_config_id) : String(row.provider ?? "openai"),
    provider: row.provider as AssistantProviderId,
    model: String(row.model),
    metadata: decode(String(row.metadata ?? "null"), null),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastMessageAt: row.last_message_at ? String(row.last_message_at) : null,
  };
}

function rowToMessage(row: Record<string, unknown>): AssistantMessage {
  return {
    id: String(row.id),
    chatId: String(row.chat_id),
    role: row.role as AssistantMessage["role"],
    content: String(row.content),
    taskId: row.task_id ? String(row.task_id) : null,
    metadata: decode(String(row.metadata ?? "null"), null),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class AssistantChatStore {
  private readonly rawSql: (query: string, params?: unknown[]) => Record<string, unknown>[];

  constructor(ctx: CoreBackendModuleContext) {
    this.rawSql = rawSqlFrom(ctx);
  }

  createChat(input: CreateAssistantChatInput = {}): AssistantChat {
    const timestamp = now();
    const chatId = id();
    this.rawSql("INSERT INTO assistant_chat (id,title,provider_config_id,provider,model,metadata,created_at,updated_at,last_message_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [chatId, input.title ?? "New chat", input.providerConfigId ?? input.provider ?? "openai", input.provider ?? input.providerConfigId ?? "openai", input.model ?? "gpt-4o-mini", encode(null), timestamp, timestamp, null]);
    return this.getChat(chatId)!;
  }

  listChats(): AssistantChat[] {
    return this.rawSql("SELECT * FROM assistant_chat ORDER BY updated_at DESC").map(rowToChat);
  }

  getChat(chatId: string): AssistantChat | null {
    const row = this.rawSql("SELECT * FROM assistant_chat WHERE id=?", [chatId])[0];
    return row ? rowToChat(row) : null;
  }

  updateChatModel(chatId: string, provider: AssistantProviderId, model: string, providerConfigId = provider): AssistantChat {
    const timestamp = now();
    this.rawSql("UPDATE assistant_chat SET provider_config_id=?, provider=?, model=?, updated_at=? WHERE id=?", [providerConfigId, provider, model, timestamp, chatId]);
    const chat = this.getChat(chatId);
    if (!chat) throw new Error(`Chat not found: ${chatId}`);
    return chat;
  }

  deleteChat(chatId: string): void {
    this.rawSql("DELETE FROM assistant_chat WHERE id=?", [chatId]);
  }

  listMessages(chatId: string): AssistantMessage[] {
    return this.rawSql("SELECT * FROM assistant_message WHERE chat_id=? ORDER BY created_at ASC", [chatId]).map(rowToMessage);
  }

  createMessage(input: {
    chatId: string;
    role: AssistantMessage["role"];
    content: string;
    taskId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): AssistantMessage {
    const timestamp = now();
    const messageId = id();
    this.rawSql("INSERT INTO assistant_message (id,chat_id,role,content,task_id,metadata,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [messageId, input.chatId, input.role, input.content, input.taskId ?? null, encode(input.metadata ?? null), timestamp, timestamp]);
    this.rawSql("UPDATE assistant_chat SET updated_at=?, last_message_at=? WHERE id=?", [timestamp, timestamp, input.chatId]);
    return this.getMessage(messageId)!;
  }

  appendMessageContent(messageId: string, content: string): void {
    const message = this.getMessage(messageId);
    if (!message) return;
    const next = `${message.content}${content}`;
    this.rawSql("UPDATE assistant_message SET content=?, updated_at=? WHERE id=?", [next, now(), messageId]);
  }

  setMessageTask(messageId: string, taskId: string): void {
    this.rawSql("UPDATE assistant_message SET task_id=?, updated_at=? WHERE id=?", [taskId, now(), messageId]);
  }

  getMessage(messageId: string): AssistantMessage | null {
    const row = this.rawSql("SELECT * FROM assistant_message WHERE id=?", [messageId])[0];
    return row ? rowToMessage(row) : null;
  }

  listToolEvents(taskId: string): Array<{
    id: string;
    chatId: string;
    assistantMessageId: string;
    taskId: string;
    kind: string;
    toolCallId: string | null;
    toolName: string | null;
    argsJson: string | null;
    resultJson: string | null;
    isError: boolean;
    createdAt: string;
  }> {
    return this.rawSql("SELECT * FROM assistant_task_tool_event WHERE task_id=? ORDER BY created_at ASC", [taskId]).map((row) => ({
      id: String(row.id),
      chatId: String(row.chat_id),
      assistantMessageId: String(row.assistant_message_id),
      taskId: String(row.task_id),
      kind: String(row.kind),
      toolCallId: row.tool_call_id ? String(row.tool_call_id) : null,
      toolName: row.tool_name ? String(row.tool_name) : null,
      argsJson: row.args_json ? String(row.args_json) : null,
      resultJson: row.result_json ? String(row.result_json) : null,
      isError: Boolean(row.is_error),
      createdAt: String(row.created_at),
    }));
  }

  getToolEvent(eventId: string): {
    id: string;
    chatId: string;
    assistantMessageId: string;
    taskId: string;
    kind: string;
    toolCallId: string | null;
    toolName: string | null;
    argsJson: string | null;
    resultJson: string | null;
    isError: boolean;
    createdAt: string;
  } | null {
    const row = this.rawSql("SELECT * FROM assistant_task_tool_event WHERE id=?", [eventId])[0];
    if (!row) return null;
    return {
      id: String(row.id),
      chatId: String(row.chat_id),
      assistantMessageId: String(row.assistant_message_id),
      taskId: String(row.task_id),
      kind: String(row.kind),
      toolCallId: row.tool_call_id ? String(row.tool_call_id) : null,
      toolName: row.tool_name ? String(row.tool_name) : null,
      argsJson: row.args_json ? String(row.args_json) : null,
      resultJson: row.result_json ? String(row.result_json) : null,
      isError: Boolean(row.is_error),
      createdAt: String(row.created_at),
    };
  }

  updateToolEventResult(eventId: string, resultJson: string, isError = false): void {
    this.rawSql("UPDATE assistant_task_tool_event SET result_json=?, is_error=? WHERE id=?", [resultJson, isError ? 1 : 0, eventId]);
  }
}
