import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  DesignerCommentAnchor,
  DesignerCommentAttachment,
  DesignerCommentCommand,
  DesignerCommentCommandEnvelope,
  DesignerCommentCommandResult,
  DesignerCommentMessage,
  DesignerCommentMessageKind,
  DesignerCommentReaction,
  DesignerCommentSurface,
  DesignerCommentSyncState,
  DesignerCommentThread,
  DesignerCommentThreadStatus,
  DesignerCommentTodoStatus,
} from "../../../../sdks/designer";
import {
  commentAttachments,
  commentMessages,
  commentOutbox,
  commentReactions,
  commentThreads,
  designHeads,
} from "../schema";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const SCREENSHOT_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

type ThreadRow = typeof commentThreads.$inferSelect;
type MessageRow = typeof commentMessages.$inferSelect;
type AttachmentRow = typeof commentAttachments.$inferSelect;

function nowIso(): string {
  return new Date().toISOString();
}

function jsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeMentions(value: readonly string[] | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.map((v) => v.trim()).filter(Boolean))].slice(0, 50);
}

function attachmentFromRow(row: AttachmentRow): DesignerCommentAttachment {
  return {
    id: row.id,
    designId: row.designId,
    threadId: row.threadId,
    messageId: row.messageId,
    fileName: row.fileName,
    mimeType: row.mimeType as DesignerCommentAttachment["mimeType"],
    byteSize: row.byteSize,
    localPath: row.localPath,
    storageKey: row.storageKey,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}

function messageFromRow(
  row: MessageRow,
  attachments: DesignerCommentAttachment[],
  reactions: DesignerCommentReaction[],
): DesignerCommentMessage {
  return {
    id: row.id,
    designId: row.designId,
    threadId: row.threadId,
    kind: row.kind as DesignerCommentMessageKind,
    body: row.deletedAt ? null : row.body,
    mentions: jsonParse<string[]>(row.mentionsJson, []),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    revision: row.revision,
    attachments,
    reactions,
  };
}

function threadFromRow(
  row: ThreadRow,
  messages?: DesignerCommentMessage[],
): DesignerCommentThread {
  return {
    id: row.id,
    designId: row.designId,
    surface: row.surface as DesignerCommentSurface,
    anchor: jsonParse<DesignerCommentAnchor | null>(row.anchorJson, null),
    status: row.status as DesignerCommentThreadStatus,
    todoStatus: row.todoStatus as DesignerCommentTodoStatus,
    title: row.title,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessageAt: row.lastMessageAt,
    messageCount: row.messageCount,
    revision: row.revision,
    syncState: row.syncState as DesignerCommentSyncState,
    deletedAt: row.deletedAt,
    ...(messages ? { messages } : {}),
  };
}

function invalid(detail: string): DesignerCommentCommandResult {
  return { ok: false, code: "INVALID_COMMENT", detail };
}

function notFound(detail: string): DesignerCommentCommandResult {
  return { ok: false, code: "COMMENT_NOT_FOUND", detail };
}

function conflict(
  detail: string,
  currentRevision?: number,
): DesignerCommentCommandResult {
  return { ok: false, code: "COMMENT_CONFLICT", detail, currentRevision };
}

function validateBody(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 4000) return null;
  return trimmed;
}

function attachmentRoot(): string {
  const dbPath = process.env.OPENPCB_DB_PATH;
  const base = dbPath
    ? path.dirname(path.resolve(dbPath))
    : path.resolve(process.cwd(), "dev-data");
  return path.join(base, "comment-attachments");
}

export interface CreateCommentStoreOptions {
  db: DbClient;
}

export interface ScreenshotUploadInput {
  attachmentId?: string;
  threadId: string;
  messageId?: string | null;
  fileName: string;
  mimeType: string;
  base64: string;
}

export function createCommentStore({ db }: CreateCommentStoreOptions) {
  function ensureDesign(designId: string): boolean {
    return Boolean(
      db
        .select({ id: designHeads.id })
        .from(designHeads)
        .where(eq(designHeads.id, designId))
        .get(),
    );
  }

  function loadThreadRow(threadId: string): ThreadRow | null {
    return (
      db
        .select()
        .from(commentThreads)
        .where(eq(commentThreads.id, threadId))
        .get() ?? null
    );
  }

  function loadMessages(
    threadId: string,
    viewer: string | null = null,
  ): DesignerCommentMessage[] {
    const rows = db
      .select()
      .from(commentMessages)
      .where(eq(commentMessages.threadId, threadId))
      .orderBy(asc(commentMessages.createdAt), asc(commentMessages.id))
      .all();
    const messageIds = rows.map((r) => r.id);
    const attachments = messageIds.length
      ? db
          .select()
          .from(commentAttachments)
          .where(
            and(
              eq(commentAttachments.threadId, threadId),
              inArray(commentAttachments.messageId, messageIds),
              isNull(commentAttachments.deletedAt),
            ),
          )
          .all()
      : [];
    const byMessage = new Map<string, DesignerCommentAttachment[]>();
    for (const row of attachments) {
      if (!row.messageId) continue;
      const list = byMessage.get(row.messageId) ?? [];
      list.push(attachmentFromRow(row));
      byMessage.set(row.messageId, list);
    }

    const reactionRows = messageIds.length
      ? db
          .select()
          .from(commentReactions)
          .where(
            and(
              inArray(commentReactions.messageId, messageIds),
              isNull(commentReactions.deletedAt),
            ),
          )
          .all()
      : [];
    // messageId → emoji → { count, mine }
    const reactionsByMessage = new Map<
      string,
      Map<string, { count: number; mine: boolean }>
    >();
    for (const row of reactionRows) {
      const perMsg = reactionsByMessage.get(row.messageId) ?? new Map();
      const agg = perMsg.get(row.emoji) ?? { count: 0, mine: false };
      agg.count += 1;
      const isMine =
        viewer === null ? row.createdBy === null : row.createdBy === viewer;
      if (isMine) agg.mine = true;
      perMsg.set(row.emoji, agg);
      reactionsByMessage.set(row.messageId, perMsg);
    }
    const reactionsFor = (messageId: string): DesignerCommentReaction[] => {
      const perMsg = reactionsByMessage.get(messageId);
      if (!perMsg) return [];
      return [...perMsg.entries()].map(([emoji, v]) => ({
        emoji,
        count: v.count,
        reactedByMe: v.mine,
      }));
    };

    return rows.map((row) =>
      messageFromRow(row, byMessage.get(row.id) ?? [], reactionsFor(row.id)),
    );
  }

  function loadThread(
    threadId: string,
    viewer: string | null = null,
  ): DesignerCommentThread | null {
    const row = loadThreadRow(threadId);
    if (!row) return null;
    return threadFromRow(row, loadMessages(threadId, viewer));
  }

  function bumpThread(
    threadId: string,
    patch: Partial<typeof commentThreads.$inferInsert> = {},
  ): number {
    const row = loadThreadRow(threadId);
    if (!row) return 0;
    const revision = row.revision + 1;
    db.update(commentThreads)
      .set({ ...patch, revision, updatedAt: nowIso(), syncState: "pending" })
      .where(eq(commentThreads.id, threadId))
      .run();
    return revision;
  }

  function enqueueOutbox(
    designId: string,
    envelope: DesignerCommentCommandEnvelope,
  ): void {
    const timestamp = nowIso();
    db.insert(commentOutbox)
      .values({
        commandId: envelope.commandId,
        designId,
        threadId: envelope.command.threadId,
        baseRevision: envelope.baseRevision,
        commandType: envelope.command.type,
        commandJson: JSON.stringify(envelope),
        status: "pending",
        attempts: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoNothing()
      .run();
  }

  const api = {
    listThreads(designId: string, surface?: DesignerCommentSurface) {
      if (!ensureDesign(designId)) return null;
      const rows = db
        .select()
        .from(commentThreads)
        .where(
          and(
            eq(commentThreads.designId, designId),
            isNull(commentThreads.deletedAt),
            surface ? eq(commentThreads.surface, surface) : undefined,
          ),
        )
        .orderBy(asc(commentThreads.createdAt), asc(commentThreads.id))
        .all();
      return rows.map((row) => threadFromRow(row));
    },

    getThread(
      designId: string,
      threadId: string,
      viewer: string | null = null,
    ) {
      if (!ensureDesign(designId)) return null;
      const thread = loadThread(threadId, viewer);
      if (!thread || thread.designId !== designId || thread.deletedAt)
        return null;
      return thread;
    },

    getAttachment(designId: string, attachmentId: string) {
      if (!ensureDesign(designId)) return null;
      const row = db
        .select()
        .from(commentAttachments)
        .where(eq(commentAttachments.id, attachmentId))
        .get();
      if (
        !row ||
        row.designId !== designId ||
        row.deletedAt ||
        !row.localPath
      ) {
        return null;
      }
      return attachmentFromRow(row);
    },

    dispatch(
      designId: string,
      envelope: DesignerCommentCommandEnvelope,
      options: { enqueue?: boolean } = { enqueue: true },
    ): DesignerCommentCommandResult {
      if (!ensureDesign(designId)) return notFound("design not found");
      if (envelope.aggregateId !== envelope.command.threadId) {
        return invalid("aggregateId must match command.threadId");
      }

      const existing = db
        .select()
        .from(commentOutbox)
        .where(eq(commentOutbox.commandId, envelope.commandId))
        .get();
      if (existing) {
        const thread = loadThread(envelope.command.threadId);
        if (thread)
          return { ok: true, threadRevision: thread.revision, thread };
      }

      const command = envelope.command;
      const timestamp = new Date(envelope.issuedAt).toISOString();
      let result: DesignerCommentCommandResult;

      db.transaction(() => {
        result = api.applyCommand(
          designId,
          command,
          envelope.baseRevision,
          timestamp,
        );
        if (result.ok && options.enqueue !== false)
          enqueueOutbox(designId, envelope);
      });

      return result!;
    },

    applyCommand(
      designId: string,
      command: DesignerCommentCommand,
      baseRevision: number | null,
      timestamp = nowIso(),
    ): DesignerCommentCommandResult {
      if (command.type === "create_thread") {
        const body = validateBody(command.body);
        if (!body)
          return invalid(
            "comment body is required and must be <= 4000 characters",
          );
        const existingThread = loadThread(command.threadId);
        if (existingThread) {
          return {
            ok: true,
            threadRevision: existingThread.revision,
            thread: existingThread,
          };
        }
        db.insert(commentThreads)
          .values({
            id: command.threadId,
            designId,
            surface: command.surface,
            anchorJson: command.anchor ? JSON.stringify(command.anchor) : null,
            status: "open",
            todoStatus: command.todoStatus ?? "none",
            title: command.title ?? null,
            createdBy: command.createdBy ?? null,
            createdAt: timestamp,
            updatedAt: timestamp,
            lastMessageAt: timestamp,
            messageCount: 1,
            revision: 1,
            syncState: "pending",
          })
          .run();
        db.insert(commentMessages)
          .values({
            id: command.messageId,
            designId,
            threadId: command.threadId,
            kind: "user",
            body,
            mentionsJson: JSON.stringify(normalizeMentions(command.mentions)),
            createdBy: command.createdBy ?? null,
            createdAt: timestamp,
            updatedAt: timestamp,
            revision: 1,
          })
          .run();
        const thread = loadThread(command.threadId)!;
        return { ok: true, threadRevision: thread.revision, thread };
      }

      const threadRow = loadThreadRow(command.threadId);
      if (
        !threadRow ||
        threadRow.designId !== designId ||
        threadRow.deletedAt
      ) {
        return notFound("thread not found");
      }
      if (baseRevision !== null && baseRevision < threadRow.revision) {
        const safe =
          command.type === "add_message" ||
          command.type === "set_thread_status" ||
          command.type === "set_thread_todo_status" ||
          command.type === "set_thread_anchor" ||
          command.type === "toggle_reaction";
        if (!safe) return conflict("thread changed", threadRow.revision);
      }

      switch (command.type) {
        case "add_message": {
          const body = validateBody(command.body);
          if (!body)
            return invalid(
              "message body is required and must be <= 4000 characters",
            );
          const existingMessage = db
            .select()
            .from(commentMessages)
            .where(eq(commentMessages.id, command.messageId))
            .get();
          if (!existingMessage) {
            db.insert(commentMessages)
              .values({
                id: command.messageId,
                designId,
                threadId: command.threadId,
                kind: "user",
                body,
                mentionsJson: JSON.stringify(
                  normalizeMentions(command.mentions),
                ),
                createdBy: command.createdBy ?? null,
                createdAt: timestamp,
                updatedAt: timestamp,
                revision: 1,
              })
              .run();
            bumpThread(command.threadId, {
              lastMessageAt: timestamp,
              messageCount: threadRow.messageCount + 1,
            });
          }
          break;
        }
        case "edit_message": {
          const body = validateBody(command.body);
          if (!body)
            return invalid(
              "message body is required and must be <= 4000 characters",
            );
          const message = db
            .select()
            .from(commentMessages)
            .where(eq(commentMessages.id, command.messageId))
            .get();
          if (
            !message ||
            message.threadId !== command.threadId ||
            message.deletedAt
          ) {
            return notFound("message not found");
          }
          db.update(commentMessages)
            .set({
              body,
              editedAt: timestamp,
              updatedAt: timestamp,
              revision: message.revision + 1,
            })
            .where(eq(commentMessages.id, command.messageId))
            .run();
          bumpThread(command.threadId);
          break;
        }
        case "delete_message": {
          const message = db
            .select()
            .from(commentMessages)
            .where(eq(commentMessages.id, command.messageId))
            .get();
          if (
            !message ||
            message.threadId !== command.threadId ||
            message.deletedAt
          ) {
            return notFound("message not found");
          }
          db.update(commentMessages)
            .set({
              deletedAt: timestamp,
              updatedAt: timestamp,
              revision: message.revision + 1,
            })
            .where(eq(commentMessages.id, command.messageId))
            .run();
          bumpThread(command.threadId);
          break;
        }
        case "set_thread_status":
          bumpThread(command.threadId, { status: command.status });
          break;
        case "set_thread_todo_status":
          bumpThread(command.threadId, { todoStatus: command.todoStatus });
          break;
        case "set_thread_anchor":
          bumpThread(command.threadId, {
            anchorJson: command.anchor ? JSON.stringify(command.anchor) : null,
            surface: command.anchor?.surface ?? threadRow.surface,
          });
          break;
        case "toggle_reaction": {
          const message = db
            .select()
            .from(commentMessages)
            .where(eq(commentMessages.id, command.messageId))
            .get();
          if (!message || message.threadId !== command.threadId) {
            return notFound("message not found");
          }
          const emoji = command.emoji.trim().slice(0, 16);
          if (!emoji) return invalid("emoji is required");
          const who = command.createdBy ?? null;
          const existing = db
            .select()
            .from(commentReactions)
            .where(
              and(
                eq(commentReactions.messageId, command.messageId),
                eq(commentReactions.emoji, emoji),
                who === null
                  ? isNull(commentReactions.createdBy)
                  : eq(commentReactions.createdBy, who),
                isNull(commentReactions.deletedAt),
              ),
            )
            .get();
          if (existing) {
            db.delete(commentReactions)
              .where(eq(commentReactions.id, existing.id))
              .run();
          } else {
            db.insert(commentReactions)
              .values({
                id: crypto.randomUUID(),
                designId,
                threadId: command.threadId,
                messageId: command.messageId,
                emoji,
                createdBy: who,
                createdAt: timestamp,
              })
              .run();
          }
          bumpThread(command.threadId);
          break;
        }
        default:
          return invalid("unsupported comment command");
      }
      const thread = loadThread(command.threadId)!;
      return { ok: true, threadRevision: thread.revision, thread };
    },

    upsertRemoteThreads(
      designId: string,
      threads: readonly DesignerCommentThread[],
    ): void {
      if (!ensureDesign(designId)) return;
      for (const thread of threads) {
        const timestamp = thread.updatedAt ?? nowIso();
        db.insert(commentThreads)
          .values({
            id: thread.id,
            designId,
            surface: thread.surface,
            anchorJson: thread.anchor ? JSON.stringify(thread.anchor) : null,
            status: thread.status,
            todoStatus: thread.todoStatus,
            title: thread.title,
            createdBy: thread.createdBy,
            createdAt: thread.createdAt,
            updatedAt: timestamp,
            lastMessageAt: thread.lastMessageAt,
            messageCount: thread.messageCount,
            revision: thread.revision,
            syncState: "synced",
            deletedAt: thread.deletedAt,
          })
          .onConflictDoUpdate({
            target: commentThreads.id,
            set: {
              surface: thread.surface,
              anchorJson: thread.anchor ? JSON.stringify(thread.anchor) : null,
              status: thread.status,
              todoStatus: thread.todoStatus,
              title: thread.title,
              updatedAt: timestamp,
              lastMessageAt: thread.lastMessageAt,
              messageCount: thread.messageCount,
              revision: thread.revision,
              syncState: "synced",
              deletedAt: thread.deletedAt,
            },
          })
          .run();
        for (const message of thread.messages ?? []) {
          db.insert(commentMessages)
            .values({
              id: message.id,
              designId,
              threadId: thread.id,
              kind: message.kind,
              body: message.body,
              mentionsJson: JSON.stringify(message.mentions),
              createdBy: message.createdBy,
              createdAt: message.createdAt,
              updatedAt: message.updatedAt,
              editedAt: message.editedAt,
              deletedAt: message.deletedAt,
              revision: message.revision,
            })
            .onConflictDoUpdate({
              target: commentMessages.id,
              set: {
                body: message.body,
                mentionsJson: JSON.stringify(message.mentions),
                updatedAt: message.updatedAt,
                editedAt: message.editedAt,
                deletedAt: message.deletedAt,
                revision: message.revision,
              },
            })
            .run();
        }
      }
    },

    async addScreenshot(
      designId: string,
      input: ScreenshotUploadInput,
    ): Promise<DesignerCommentAttachment | null> {
      if (!ensureDesign(designId)) return null;
      const thread = loadThreadRow(input.threadId);
      if (!thread || thread.designId !== designId || thread.deletedAt)
        return null;
      if (!SCREENSHOT_MIME_TYPES.has(input.mimeType)) return null;
      const data = Buffer.from(input.base64, "base64");
      if (data.byteLength <= 0 || data.byteLength > MAX_SCREENSHOT_BYTES)
        return null;
      const id = input.attachmentId ?? crypto.randomUUID();
      const safeExt =
        input.mimeType === "image/png"
          ? "png"
          : input.mimeType === "image/webp"
            ? "webp"
            : "jpg";
      const dir = path.join(attachmentRoot(), designId, input.threadId);
      await mkdir(dir, { recursive: true });
      const localPath = path.join(dir, `${id}.${safeExt}`);
      await writeFile(localPath, data);
      const timestamp = nowIso();
      db.insert(commentAttachments)
        .values({
          id,
          designId,
          threadId: input.threadId,
          messageId: input.messageId ?? null,
          fileName: input.fileName,
          mimeType: input.mimeType,
          byteSize: data.byteLength,
          localPath,
          createdAt: timestamp,
        })
        .run();
      bumpThread(input.threadId);
      const row = db
        .select()
        .from(commentAttachments)
        .where(eq(commentAttachments.id, id))
        .get();
      return row ? attachmentFromRow(row) : null;
    },
  };
  return api;
}
