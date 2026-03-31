import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { uuidPrimaryKey, timestamps } from "./base";
import { message } from "./message";

export const messageMention = sqliteTable(
  "message_mention",
  {
    ...uuidPrimaryKey,

    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),

    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),

    displayText: text("display_text").notNull(),

    snapshotData: text("snapshot_data", { mode: "json" })
      .notNull()
      .$type<Record<string, unknown>>(),
    snapshotCreatedAt: text("snapshot_created_at").notNull(),

    entityVersion: text("entity_version").notNull(),

    position: integer("position").notNull().default(0),

    ...timestamps,
  },
  (table) => ({
    messageIdx: index("idx_mention_message").on(table.messageId),
    entityIdx: index("idx_mention_entity").on(table.entityType, table.entityId),
    entityTypeIdx: index("idx_mention_entity_type").on(table.entityType),
  }),
);

export type MessageMention = typeof messageMention.$inferSelect;
export type NewMessageMention = typeof messageMention.$inferInsert;
