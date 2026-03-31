import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";
import { chat } from "./chat";
import { message } from "./message";
import { task } from "./task";

export const TASK_TOOL_EVENT_KINDS = ["tool-call", "tool-result"] as const;
export type TaskToolEventKind = (typeof TASK_TOOL_EVENT_KINDS)[number];

export const taskToolEvent = sqliteTable(
  "task_tool_event",
  {
    ...uuidPrimaryKey,
    chatId: text("chat_id")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    assistantMessageId: text("assistant_message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind", { enum: TASK_TOOL_EVENT_KINDS }).notNull(),
    toolCallId: text("tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    args: text("args", { mode: "json" }).$type<unknown>(),
    result: text("result", { mode: "json" }).$type<unknown>(),
    isError: integer("is_error", { mode: "boolean" }),
    ...timestamps,
  },
  (table) => ({
    assistantMessageSeqIdx: index("idx_task_tool_event_assistant_seq").on(
      table.assistantMessageId,
      table.seq,
    ),
    chatCreatedIdx: index("idx_task_tool_event_chat_created").on(
      table.chatId,
      table.createdAt,
    ),
    taskIdx: index("idx_task_tool_event_task").on(table.taskId),
    toolCallIdx: index("idx_task_tool_event_tool_call").on(table.toolCallId),
  }),
);

export type TaskToolEvent = typeof taskToolEvent.$inferSelect;
export type NewTaskToolEvent = typeof taskToolEvent.$inferInsert;
