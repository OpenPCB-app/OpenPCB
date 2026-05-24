import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import type {
  AssistantChat,
  AssistantContextBindingDto,
  AssistantMessage,
  AssistantMessageMetadata,
  AssistantMessagesPage,
  AssistantPromptPresetId,
  AssistantRole,
  AssistantToolEventDto,
  AiContextBinding,
  AiContextBindingKind,
  AiContextBindingRole,
  AiContextBindingStatus,
  AiToolStatus,
  AiSourceRef,
  AssistantWriteProposalDto,
  AssistantWriteProposalKind,
  AssistantWriteProposalStatus,
} from "../../../sdks/assistant";

type RawSqlFn = (
  query: string,
  params?: unknown[],
) => Record<string, unknown>[];

function rawSqlFrom(ctx: CoreBackendModuleContext): RawSqlFn {
  return (
    ctx.db as { rawSql<T = unknown>(q: string, p?: unknown[]): T[] }
  ).rawSql.bind(ctx.db);
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
function decodeJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  const text = String(value);
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function rowToChat(row: Record<string, unknown>): AssistantChat {
  return {
    id: String(row.id),
    title: String(row.title),
    providerConfigId: String(row.provider_config_id),
    model: String(row.model),
    promptPresetId: String(row.prompt_preset_id) as AssistantPromptPresetId,
    metadata: decodeJson(row.metadata, null),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastMessageAt: row.last_message_at ? String(row.last_message_at) : null,
  };
}

function rowToMessage(row: Record<string, unknown>): AssistantMessage {
  return {
    id: String(row.id),
    chatId: String(row.chat_id),
    role: String(row.role) as AssistantRole,
    content: String(row.content),
    toolCallId: row.tool_call_id ? String(row.tool_call_id) : null,
    toolCallsJson: row.tool_calls_json ? String(row.tool_calls_json) : null,
    toolName: row.tool_name ? String(row.tool_name) : null,
    taskId: row.task_id ? String(row.task_id) : null,
    metadata: decodeJson<AssistantMessageMetadata | null>(row.metadata, null),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToBinding(
  row: Record<string, unknown>,
): AssistantContextBindingDto {
  return {
    id: String(row.id),
    chatId: String(row.chat_id),
    kind: String(row.kind) as AiContextBindingKind,
    refId: String(row.ref_id),
    label: String(row.label),
    role: String(row.role) as AiContextBindingRole,
    status: String(row.status) as AiContextBindingStatus,
    metadata: decodeJson<Record<string, unknown> | undefined>(
      row.metadata,
      undefined,
    ),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToToolEvent(row: Record<string, unknown>): AssistantToolEventDto {
  return {
    id: String(row.id),
    chatId: String(row.chat_id),
    taskId: row.task_id ? String(row.task_id) : null,
    messageId: row.message_id ? String(row.message_id) : null,
    toolCallId: String(row.tool_call_id),
    toolName: String(row.tool_name),
    status: String(row.status) as AiToolStatus,
    argumentsJson: String(row.arguments_json),
    resultJson: row.result_json ? String(row.result_json) : null,
    errorJson: row.error_json ? String(row.error_json) : null,
    sources: decodeJson<AiSourceRef[]>(row.sources_json, []),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToWriteProposal(
  row: Record<string, unknown>,
): AssistantWriteProposalDto {
  return {
    id: String(row.id),
    chatId: String(row.chat_id),
    toolEventId: row.tool_event_id ? String(row.tool_event_id) : null,
    kind: String(row.kind) as AssistantWriteProposalKind,
    status: String(row.status) as AssistantWriteProposalStatus,
    designId: String(row.design_id),
    baseRevision:
      row.base_revision === null || row.base_revision === undefined
        ? null
        : Number(row.base_revision),
    proposal: decodeJson(row.proposal_json, null),
    applyResult: decodeJson(row.apply_result_json, null),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export interface CreateChatRecord {
  title: string;
  providerConfigId: string;
  model: string;
  promptPresetId: AssistantPromptPresetId;
  metadata?: Record<string, unknown> | null;
}

export interface CreateMessageRecord {
  chatId: string;
  role: AssistantRole;
  content: string;
  toolCallId?: string | null;
  toolCallsJson?: string | null;
  toolName?: string | null;
  taskId?: string | null;
  metadata?: AssistantMessageMetadata | null;
}

export interface UpsertToolEventInput {
  id?: string;
  chatId: string;
  taskId: string | null;
  messageId: string | null;
  toolCallId: string;
  toolName: string;
  status: AiToolStatus;
  argumentsJson: string;
  resultJson?: string | null;
  errorJson?: string | null;
  sources?: AiSourceRef[];
}

export interface CreateWriteProposalInput {
  id?: string;
  chatId: string;
  toolEventId?: string | null;
  kind: AssistantWriteProposalKind;
  designId: string;
  baseRevision: number | null;
  proposal: unknown;
}

export interface ListMessagesOptions {
  limit?: number;
  before?: string | null;
}

function clampLimit(limit: number | undefined, fallback = 50): number {
  if (!Number.isFinite(limit ?? NaN)) return fallback;
  return Math.max(1, Math.min(200, Math.floor(limit!)));
}

function parseMessageCursor(cursor: string | null | undefined): {
  createdAt: string;
  id: string;
} | null {
  if (!cursor) return null;
  const idx = cursor.lastIndexOf("|");
  if (idx <= 0 || idx >= cursor.length - 1) return null;
  return { createdAt: cursor.slice(0, idx), id: cursor.slice(idx + 1) };
}

function messageCursor(message: AssistantMessage): string {
  return `${message.createdAt}|${message.id}`;
}

export class ConversationStore {
  private readonly rawSql: RawSqlFn;

  constructor(ctx: CoreBackendModuleContext) {
    this.rawSql = rawSqlFrom(ctx);
  }

  // ---------- chats ----------
  createChat(input: CreateChatRecord): AssistantChat {
    const timestamp = now();
    const chatId = id();
    // Legacy schema has `provider TEXT NOT NULL` on assistant_chat. Mirror providerConfigId
    // into it for back-compat with pre-v1 DBs. Column is unused by v1 code.
    this.rawSql(
      "INSERT INTO assistant_chat (id,title,provider_config_id,provider,model,prompt_preset_id,metadata,created_at,updated_at,last_message_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        chatId,
        input.title,
        input.providerConfigId,
        input.providerConfigId,
        input.model,
        input.promptPresetId,
        encode(input.metadata ?? null),
        timestamp,
        timestamp,
        null,
      ],
    );
    const chat = this.getChat(chatId);
    if (!chat) throw new Error("Chat insert failed");
    return chat;
  }

  listChats(): AssistantChat[] {
    return this.rawSql(
      "SELECT * FROM assistant_chat ORDER BY updated_at DESC",
    ).map(rowToChat);
  }

  getChat(chatId: string): AssistantChat | null {
    const row = this.rawSql("SELECT * FROM assistant_chat WHERE id=?", [
      chatId,
    ])[0];
    return row ? rowToChat(row) : null;
  }

  updateChat(
    chatId: string,
    patch: Partial<{
      providerConfigId: string;
      model: string;
      promptPresetId: AssistantPromptPresetId;
      title: string;
      metadata: Record<string, unknown> | null;
    }>,
  ): AssistantChat {
    const current = this.getChat(chatId);
    if (!current) throw new Error(`Chat not found: ${chatId}`);
    const next = {
      providerConfigId: patch.providerConfigId ?? current.providerConfigId,
      model: patch.model ?? current.model,
      promptPresetId: patch.promptPresetId ?? current.promptPresetId,
      title: patch.title ?? current.title,
      metadata: patch.metadata === undefined ? current.metadata : patch.metadata,
    };
    this.rawSql(
      "UPDATE assistant_chat SET provider_config_id=?, model=?, prompt_preset_id=?, title=?, metadata=?, updated_at=? WHERE id=?",
      [
        next.providerConfigId,
        next.model,
        next.promptPresetId,
        next.title,
        encode(next.metadata),
        now(),
        chatId,
      ],
    );
    return this.getChat(chatId)!;
  }

  listChatsForDesign(designId: string): AssistantChat[] {
    return this.listChats().filter((chat) => {
      const metadata = chat.metadata;
      return (
        metadata !== null &&
        typeof metadata === "object" &&
        metadata.designId === designId &&
        metadata.scope === "designer"
      );
    });
  }

  deleteChat(chatId: string): void {
    this.rawSql("DELETE FROM assistant_chat WHERE id=?", [chatId]);
  }

  // ---------- messages ----------
  listMessages(
    chatId: string,
    options: ListMessagesOptions = {},
  ): AssistantMessagesPage {
    const limit = clampLimit(options.limit);
    const cursor = parseMessageCursor(options.before);
    const rows = cursor
      ? this.rawSql(
          "SELECT * FROM assistant_message WHERE chat_id=? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?",
          [chatId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1],
        )
      : this.rawSql(
          "SELECT * FROM assistant_message WHERE chat_id=? ORDER BY created_at DESC, id DESC LIMIT ?",
          [chatId, limit + 1],
        );
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit).reverse();
    const items = pageRows.map(rowToMessage);
    return {
      items,
      hasMore,
      nextCursor: items.length > 0 && hasMore ? messageCursor(items[0]!) : null,
    };
  }

  getMessage(messageId: string): AssistantMessage | null {
    const row = this.rawSql("SELECT * FROM assistant_message WHERE id=?", [
      messageId,
    ])[0];
    return row ? rowToMessage(row) : null;
  }

  createMessage(input: CreateMessageRecord): AssistantMessage {
    const timestamp = now();
    const messageId = id();
    this.rawSql(
      "INSERT INTO assistant_message (id,chat_id,role,content,tool_call_id,tool_calls_json,tool_name,task_id,metadata,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        messageId,
        input.chatId,
        input.role,
        input.content,
        input.toolCallId ?? null,
        input.toolCallsJson ?? null,
        input.toolName ?? null,
        input.taskId ?? null,
        encode(input.metadata ?? null),
        timestamp,
        timestamp,
      ],
    );
    this.rawSql(
      "UPDATE assistant_chat SET updated_at=?, last_message_at=? WHERE id=?",
      [timestamp, timestamp, input.chatId],
    );
    return this.getMessage(messageId)!;
  }

  appendMessageContent(messageId: string, content: string): void {
    const message = this.getMessage(messageId);
    if (!message) return;
    const next = `${message.content}${content}`;
    this.rawSql(
      "UPDATE assistant_message SET content=?, updated_at=? WHERE id=?",
      [next, now(), messageId],
    );
  }

  setMessageContent(messageId: string, content: string): void {
    this.rawSql(
      "UPDATE assistant_message SET content=?, updated_at=? WHERE id=?",
      [content, now(), messageId],
    );
  }

  setMessageMetadata(
    messageId: string,
    metadata: AssistantMessageMetadata | null,
  ): void {
    this.rawSql(
      "UPDATE assistant_message SET metadata=?, updated_at=? WHERE id=?",
      [encode(metadata), now(), messageId],
    );
  }

  setMessageToolCalls(messageId: string, toolCallsJson: string | null): void {
    this.rawSql(
      "UPDATE assistant_message SET tool_calls_json=?, updated_at=? WHERE id=?",
      [toolCallsJson, now(), messageId],
    );
  }

  setMessageTask(messageId: string, taskId: string): void {
    this.rawSql(
      "UPDATE assistant_message SET task_id=?, updated_at=? WHERE id=?",
      [taskId, now(), messageId],
    );
  }

  // ---------- bindings ----------
  listBindings(chatId: string): AssistantContextBindingDto[] {
    return this.rawSql(
      "SELECT * FROM assistant_context_binding WHERE chat_id=? ORDER BY created_at ASC",
      [chatId],
    ).map(rowToBinding);
  }

  createBinding(
    chatId: string,
    binding: AiContextBinding,
  ): AssistantContextBindingDto {
    const timestamp = now();
    this.rawSql(
      "INSERT INTO assistant_context_binding (id,chat_id,kind,ref_id,label,role,status,metadata,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        binding.id,
        chatId,
        binding.kind,
        binding.refId,
        binding.label,
        binding.role,
        binding.status,
        encode(binding.metadata ?? null),
        timestamp,
        timestamp,
      ],
    );
    const row = this.rawSql(
      "SELECT * FROM assistant_context_binding WHERE id=?",
      [binding.id],
    )[0];
    return rowToBinding(row!);
  }

  updateBindingStatus(bindingId: string, status: AiContextBindingStatus): void {
    this.rawSql(
      "UPDATE assistant_context_binding SET status=?, updated_at=? WHERE id=?",
      [status, now(), bindingId],
    );
  }

  deleteBinding(chatId: string, bindingId: string): void {
    this.rawSql("DELETE FROM assistant_context_binding WHERE chat_id=? AND id=?", [
      chatId,
      bindingId,
    ]);
  }

  // ---------- tool events ----------
  listToolEvents(
    chatId: string,
    options: { messageId?: string; messageIds?: string[] } = {},
  ): AssistantToolEventDto[] {
    if (options.messageIds && options.messageIds.length > 0) {
      const ids = [...new Set(options.messageIds.filter(Boolean))];
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => "?").join(",");
      return this.rawSql(
        `SELECT * FROM assistant_tool_event WHERE chat_id=? AND message_id IN (${placeholders}) ORDER BY created_at ASC`,
        [chatId, ...ids],
      ).map(rowToToolEvent);
    }
    if (options.messageId) {
      return this.rawSql(
        "SELECT * FROM assistant_tool_event WHERE chat_id=? AND message_id=? ORDER BY created_at ASC",
        [chatId, options.messageId],
      ).map(rowToToolEvent);
    }
    return this.rawSql(
      "SELECT * FROM assistant_tool_event WHERE chat_id=? ORDER BY created_at ASC",
      [chatId],
    ).map(rowToToolEvent);
  }

  upsertToolEvent(input: UpsertToolEventInput): AssistantToolEventDto {
    const timestamp = now();
    const existing = input.id
      ? this.rawSql("SELECT id FROM assistant_tool_event WHERE id=?", [
          input.id,
        ])[0]
      : undefined;
    const eventId = (existing?.id as string | undefined) ?? input.id ?? id();
    const sourcesJson = JSON.stringify(input.sources ?? []);
    if (existing) {
      this.rawSql(
        "UPDATE assistant_tool_event SET status=?, result_json=?, error_json=?, sources_json=?, message_id=COALESCE(?, message_id), task_id=COALESCE(?, task_id), updated_at=? WHERE id=?",
        [
          input.status,
          input.resultJson ?? null,
          input.errorJson ?? null,
          sourcesJson,
          input.messageId,
          input.taskId,
          timestamp,
          eventId,
        ],
      );
    } else {
      this.rawSql(
        "INSERT INTO assistant_tool_event (id,chat_id,task_id,message_id,tool_call_id,tool_name,status,arguments_json,result_json,error_json,sources_json,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          eventId,
          input.chatId,
          input.taskId,
          input.messageId,
          input.toolCallId,
          input.toolName,
          input.status,
          input.argumentsJson,
          input.resultJson ?? null,
          input.errorJson ?? null,
          sourcesJson,
          timestamp,
          timestamp,
        ],
      );
    }
    const row = this.rawSql("SELECT * FROM assistant_tool_event WHERE id=?", [
      eventId,
    ])[0]!;
    return rowToToolEvent(row);
  }

  // ---------- write proposals ----------
  createWriteProposal(input: CreateWriteProposalInput): AssistantWriteProposalDto {
    const timestamp = now();
    const proposalId = input.id ?? id();
    this.rawSql(
      "INSERT INTO assistant_write_proposal (id,chat_id,tool_event_id,kind,status,design_id,base_revision,proposal_json,apply_result_json,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        proposalId,
        input.chatId,
        input.toolEventId ?? null,
        input.kind,
        "pending",
        input.designId,
        input.baseRevision,
        encode(input.proposal),
        null,
        timestamp,
        timestamp,
      ],
    );
    return this.getWriteProposal(input.chatId, proposalId)!;
  }

  getWriteProposal(
    chatId: string,
    proposalId: string,
  ): AssistantWriteProposalDto | null {
    const row = this.rawSql(
      "SELECT * FROM assistant_write_proposal WHERE chat_id=? AND id=?",
      [chatId, proposalId],
    )[0];
    return row ? rowToWriteProposal(row) : null;
  }

  listWriteProposals(chatId: string): AssistantWriteProposalDto[] {
    return this.rawSql(
      "SELECT * FROM assistant_write_proposal WHERE chat_id=? ORDER BY created_at ASC",
      [chatId],
    ).map(rowToWriteProposal);
  }

  updateWriteProposalStatus(
    chatId: string,
    proposalId: string,
    status: AssistantWriteProposalStatus,
    applyResult: unknown | null = null,
  ): AssistantWriteProposalDto {
    this.rawSql(
      "UPDATE assistant_write_proposal SET status=?, apply_result_json=?, updated_at=? WHERE chat_id=? AND id=?",
      [status, applyResult === null ? null : encode(applyResult), now(), chatId, proposalId],
    );
    const next = this.getWriteProposal(chatId, proposalId);
    if (!next) throw new Error(`Write proposal not found: ${proposalId}`);
    return next;
  }
}
